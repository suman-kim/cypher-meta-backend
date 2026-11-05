/**
 * live-alert.source.ts
 *
 * 방송 시작 알림 감지 작업(LiveAlertSource).
 *  1) 라이브 구독(kind=live)이 있는 플랫폼만 지금 방송 목록을 가져온다(치지직: 감지 전용 전체 목록, 유튜브: 15분 캐시 목록).
 *  2) 직전 목록(메모리, 플랫폼별)과 비교해 새로 나타난 채널을 찾는다. 첫 조회는 기준점만 잡는다.
 *     조회에 실패한 플랫폼은 직전 목록을 유지한다(복구 순간 전부 '새 방송'으로 보이지 않게).
 *  3) 새 채널 중 구독자가 있고, 30분 안에 알린 적 없는 채널만 구독 기기에 보낸다.
 * 판단 로직은 alert-logic.ts 의 순수 함수에 있다. 새 플랫폼(SOOP 등)은 feeds 에 조회 함수를 하나 더하면 된다.
 */
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChzzkService } from "../../chzzk/chzzk.service";
import { YoutubeService } from "../../youtube/youtube.service";
import { PushDeliveryService } from "../push-delivery.service";
import { PushService } from "../push.service";
import {
  buildLiveMessage,
  computeLiveTransition,
  filterCooldown,
  LIVE_COOLDOWN_MS,
  LiveInfo,
  liveKey,
  LiveSnapshot,
  platformOfLiveKey,
  pruneCooldown,
} from "./alert-logic";
import { AlertSource } from "./alert-source";
import { readIntervalSec } from "./interval";

/** 감지에 쓰는 라이브 1건(키 + 알림 문구 재료) */
interface DetectedLive extends LiveInfo {
  /** "플랫폼:채널ID" */
  key: string;
}

/** 방송 시작 알림 감지 작업 */
@Injectable()
export class LiveAlertSource implements AlertSource {
  /** 작업 이름 */
  readonly name = "live";
  /** 실행 간격(초) — PUSH_LIVE_INTERVAL_SEC, 기본 120, 최소 30 */
  readonly intervalSec: number;
  /** 로거 */
  private readonly logger = new Logger(LiveAlertSource.name);
  /** 직전 틱의 플랫폼별 라이브 키 집합 */
  private snapshot: LiveSnapshot = new Map();
  /** 채널(라이브 키)별 마지막 알림 시각(ms) — 30분 쿨다운 */
  private readonly lastSentAt = new Map<string, number>();
  /** 플랫폼별 마지막 조회 오류 문구 — 같은 오류가 반복되면 경고 대신 debug 로만 남긴다 */
  private readonly lastError = new Map<string, string>();
  /** 플랫폼별 '지금 방송 목록' 조회 함수. 실패하면 예외를 던져야 한다(빈 목록과 구분) */
  private readonly feeds: Record<string, () => Promise<DetectedLive[]>>;

  /**
   * @param env — 간격 env 읽기용
   * @param chzzk — 치지직 라이브 조회
   * @param youtube — 유튜브 라이브 조회(캐시 우회하지 않음)
   * @param push — 구독 조회
   * @param delivery — 발송
   */
  constructor(
    env: ConfigService,
    private readonly chzzk: ChzzkService,
    private readonly youtube: YoutubeService,
    private readonly push: PushService,
    private readonly delivery: PushDeliveryService,
  ) {
    this.intervalSec = readIntervalSec(env, "PUSH_LIVE_INTERVAL_SEC", 120, 30);
    this.feeds = {
      chzzk: () => this.fetchChzzk(),
      youtube: () => this.fetchYoutube(),
      // soop: 아직 백엔드에 SOOP 라이브 조회가 없다 — 생기면 여기에 추가.
    };
  }

  /** 한 번 점검하고 새로 방송을 켠 구독 채널에 알린다 */
  async run(): Promise<void> {
    const targets = await this.push.listTargetIds("live");
    if (!targets.length) {
      this.snapshot = new Map(); // 구독자가 없으면 아무것도 안 함(다음에 생기면 기준점부터)
      return;
    }
    const subscribed = new Set(targets);
    const platforms = [...new Set(targets.map(platformOfLiveKey))].filter((p) => this.feeds[p]);

    const fetched = new Map<string, Set<string> | null>();
    const infos = new Map<string, DetectedLive>();
    await Promise.all(
      platforms.map(async (platform) => {
        try {
          const lives = await this.feeds[platform]();
          fetched.set(platform, new Set(lives.map((l) => l.key)));
          for (const l of lives) if (!infos.has(l.key)) infos.set(l.key, l);
          this.lastError.delete(platform);
        } catch (e) {
          fetched.set(platform, null); // 실패 → 직전 상태 유지
          const msg = `${platform} 라이브 조회 실패(직전 상태 유지): ${(e as Error).message}`;
          if (this.lastError.get(platform) === msg) this.logger.debug(msg);
          else this.logger.warn(msg);
          this.lastError.set(platform, msg);
        }
      }),
    );

    const { started, next } = computeLiveTransition(this.snapshot, fetched);
    this.snapshot = next;

    const now = Date.now();
    pruneCooldown(this.lastSentAt, now, LIVE_COOLDOWN_MS);
    const keys = filterCooldown(
      started.filter((k) => subscribed.has(k)),
      this.lastSentAt,
      now,
      LIVE_COOLDOWN_MS,
    );
    this.logger.debug(
      `방송 점검: 구독 채널 ${subscribed.size}개, 조회 ${[...fetched.keys()].join("/") || "없음"}, ` +
        `새 방송 ${started.length}개(알릴 것 ${keys.length}개)`,
    );
    if (!keys.length) return;

    const subs = await this.push.findSubscriptions("live", keys);
    const byKey = new Map<string, { installIds: string[]; label: string | null }>();
    for (const s of subs) {
      const g = byKey.get(s.targetId) ?? { installIds: [], label: s.label };
      g.installIds.push(s.installId);
      byKey.set(s.targetId, g);
    }
    for (const [key, g] of byKey) {
      const info = infos.get(key);
      if (!info) continue;
      this.lastSentAt.set(key, now);
      const res = await this.delivery.deliver(g.installIds, buildLiveMessage(info, g.label));
      this.logger.log(
        `방송 시작 알림: ${key} → 기기 ${res.devices}대(성공 ${res.successCount}, 실패 ${res.failureCount})`,
      );
    }
  }

  /** 치지직 사이퍼즈 라이브(감지 전용 전체 목록) */
  private async fetchChzzk(): Promise<DetectedLive[]> {
    const lives = await this.chzzk.getCyphersLivesForAlerts();
    return lives.map((l) => ({
      key: liveKey("chzzk", l.channelId),
      channelName: l.channelName,
      title: l.title,
      url: l.url,
    }));
  }

  /**
   * 유튜브 사이퍼즈 라이브(15분 캐시 목록, 최대 20개). 키가 없거나 조회 오류가 기록돼 있으면 실패로 본다.
   * (유튜브 서비스는 실패해도 빈 목록을 돌려주므로 debug 정보로 실패를 구분한다)
   */
  private async fetchYoutube(): Promise<DetectedLive[]> {
    const res = await this.youtube.getCyphersLives(20);
    if (res.debug && res.debug.keyPresent === false) throw new Error("YOUTUBE_API_KEY 미설정");
    if (res.debug?.error) throw new Error(String(res.debug.error));
    return res.lives.map((l) => ({
      key: liveKey("youtube", l.channelId),
      channelName: l.channelName,
      title: l.title,
      url: l.url,
    }));
  }
}
