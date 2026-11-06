/**
 * match-alert.source.ts
 *
 * 전적 갱신 알림 감지 작업(MatchAlertSource).
 *  1) 전적 구독(kind=player)의 서로 다른 playerId 를 모은다. 없으면 끝.
 *  2) 플레이어마다(동시 4명까지) Neople 매치 목록을 공식전·일반전 각각 최근 몇 건 조회한다(캐시 우회·저장 안 함).
 *  3) 구독 행마다 lastEventAt 과 비교해 새 경기(최근 6시간 안)를 찾고, 있으면 그 기기에 알린 뒤 lastEventAt 을 올린다.
 *     lastEventAt 이 비어 있으면 기준점만 잡는다. 한 플레이어 조회가 실패하면 그 플레이어만 건너뛴다.
 * Neople 전적은 저쪽에서 약 1시간 주기로 갱신되므로, 경기 직후가 아니라 반영된 뒤에 알림이 간다.
 */
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { parseNeopleDate } from "../../meta/match-parser";
import { NeopleService } from "../../neople/neople.service";
import type { PushMessage } from "../push-message";
import { PushDeliveryService } from "../push-delivery.service";
import { PushService } from "../push.service";
import { buildMatchMessage, decideMatchAlert, GameType, mapWithConcurrency, MatchSummary } from "./alert-logic";
import { AlertSource } from "./alert-source";
import { readIntervalSec } from "./interval";

/** 조회할 게임 종류(공식전·일반전) */
const GAME_TYPES: GameType[] = ["rating", "normal"];
/** 게임 종류별로 가져올 최근 경기 수 */
const RECENT_LIMIT = 10;
/** 동시에 조회할 최대 플레이어 수 */
const CONCURRENCY = 4;

/** 플레이어 1명의 최근 전적 */
interface PlayerRecent {
  /** Neople 응답의 닉네임(없으면 null) */
  nickname: string | null;
  /** 최근 경기(공식전·일반전 합침) */
  matches: MatchSummary[];
}

/** 한 틱의 처리 통계(로그용) */
interface MatchTickStats {
  /** 점검한 플레이어 수 */
  players: number;
  /** 조회에 실패해 건너뛴 플레이어 수 */
  failed: number;
  /** 기준점을 새로 잡은 구독 수 */
  baseline: number;
  /** 알림을 보낸 구독(기기) 수 */
  notified: number;
}

/** 전적 갱신 알림 감지 작업 */
@Injectable()
export class MatchAlertSource implements AlertSource {
  /** 작업 이름 */
  readonly name = "match";
  /** 실행 간격(초) — PUSH_MATCH_INTERVAL_SEC, 기본 600, 최소 60 */
  readonly intervalSec: number;
  /** 로거 */
  private readonly logger = new Logger(MatchAlertSource.name);

  /**
   * @param env — 간격 env 읽기용
   * @param neople — Neople API 호출(캐시 우회 옵션 사용)
   * @param push — 구독 조회·lastEventAt 저장
   * @param delivery — 발송
   */
  constructor(
    env: ConfigService,
    private readonly neople: NeopleService,
    private readonly push: PushService,
    private readonly delivery: PushDeliveryService,
  ) {
    this.intervalSec = readIntervalSec(env, "PUSH_MATCH_INTERVAL_SEC", 600, 60);
  }

  /** 한 번 점검하고 새 경기가 있는 구독 기기에 알린다 */
  async run(): Promise<void> {
    const subs = await this.push.listSubscriptions("player");
    if (!subs.length) return;

    const byPlayer = new Map<string, typeof subs>();
    for (const s of subs) {
      const list = byPlayer.get(s.targetId) ?? [];
      list.push(s);
      byPlayer.set(s.targetId, list);
    }

    const stats: MatchTickStats = { players: byPlayer.size, failed: 0, baseline: 0, notified: 0 };
    await mapWithConcurrency([...byPlayer.entries()], CONCURRENCY, async ([playerId, rows]) => {
      let recent: PlayerRecent;
      try {
        recent = await this.fetchRecent(playerId);
      } catch (e) {
        stats.failed++; // 실패 수는 아래 요약 로그(log 레벨)에 남는다
        this.logger.debug(`전적 조회 실패(${playerId}) — 이번엔 건너뜀: ${(e as Error).message}`);
        return;
      }
      try {
        await this.handlePlayer(playerId, rows, recent, new Date(), stats);
      } catch (e) {
        this.logger.error(`전적 알림 처리 실패(${playerId}): ${(e as Error).message}`);
      }
    });

    const msg = `전적 알림 점검: 플레이어 ${stats.players}명, 기준점 ${stats.baseline}건, 알림 ${stats.notified}건, 실패 ${stats.failed}명`;
    if (stats.baseline || stats.notified || stats.failed) this.logger.log(msg);
    else this.logger.debug(msg);
  }

  /**
   * 플레이어 1명의 구독 행들을 판단해 lastEventAt 을 저장하고 알림을 보낸다.
   * 같은 문구가 나오는 기기끼리는 한 번에 묶어 보낸다. lastEventAt 을 먼저 저장해 중복 알림을 막는다.
   * @param playerId — Neople playerId
   * @param rows — 이 플레이어를 구독한 행들
   * @param recent — 최근 전적
   * @param now — 판단 기준 시각
   * @param stats — 통계(누적)
   */
  private async handlePlayer(
    playerId: string,
    rows: Array<{ id: string; installId: string; label: string | null; lastEventAt: Date | null }>,
    recent: PlayerRecent,
    now: Date,
    stats: MatchTickStats,
  ): Promise<void> {
    const updates = new Map<number, string[]>(); // 저장할 시각(ms) → 구독 행 ID
    const sends = new Map<string, { message: PushMessage; installIds: string[] }>(); // 문구 → 기기들
    for (const row of rows) {
      const d = decideMatchAlert(row.lastEventAt, recent.matches, now);
      if (d.baseline) stats.baseline++;
      if (d.nextLastEventAt) {
        const t = d.nextLastEventAt.getTime();
        updates.set(t, [...(updates.get(t) ?? []), row.id]);
      }
      if (!d.newMatches.length) continue;
      const message = buildMatchMessage(recent.nickname ?? row.label, playerId, d.newMatches);
      const key = `${message.title}\n${message.body}\n${message.url}`;
      const g = sends.get(key) ?? { message, installIds: [] };
      g.installIds.push(row.installId);
      sends.set(key, g);
    }
    for (const [t, ids] of updates) await this.push.setLastEventAt(ids, new Date(t));
    for (const g of sends.values()) {
      const res = await this.delivery.deliver(g.installIds, g.message);
      stats.notified += g.installIds.length;
      this.logger.log(
        `전적 알림: ${playerId} "${g.message.title}" → 기기 ${res.devices}대(성공 ${res.successCount}, 실패 ${res.failureCount})`,
      );
    }
  }

  /**
   * 플레이어 1명의 최근 공식전·일반전을 Neople 에서 새로 받아 요약한다(캐시 읽기 우회, 저장 안 함).
   * 둘 중 하나라도 실패하면 예외 — 일부만 보고 기준점을 올리면 다른 쪽 새 경기를 놓칠 수 있다.
   * @param playerId — Neople playerId
   * @returns 닉네임과 최근 경기 목록
   */
  private async fetchRecent(playerId: string): Promise<PlayerRecent> {
    const responses = await Promise.all(
      GAME_TYPES.map((gt) =>
        this.neople.proxy(
          `/players/${encodeURIComponent(playerId)}/matches?gameTypeId=${gt}&limit=${RECENT_LIMIT}`,
          { fresh: true, store: false },
        ),
      ),
    );
    let nickname: string | null = null;
    const matches: MatchSummary[] = [];
    responses.forEach((resp, i) => {
      const r = (resp ?? {}) as Record<string, any>;
      if (!nickname && typeof r.nickname === "string" && r.nickname.trim()) nickname = r.nickname.trim();
      const mm = r.matches;
      const items: any[] = Array.isArray(mm) ? mm : Array.isArray(mm?.rows) ? mm.rows : [];
      for (const it of items) {
        const m = this.toSummary(it, GAME_TYPES[i]);
        if (m) matches.push(m);
      }
    });
    return { nickname, matches };
  }

  /**
   * Neople 매치 목록 1행 → 알림 판단용 요약. matchId·시각이 없으면 null.
   * (경기 시각은 KST 문자열이므로 meta/match-parser 의 parseNeopleDate 로 +09:00 해석)
   * @param item — 매치 목록 1행(raw)
   * @param gameType — 조회한 게임 종류
   * @returns 요약 또는 null
   */
  private toSummary(item: any, gameType: GameType): MatchSummary | null {
    const matchId = item?.matchId;
    const playedAt = parseNeopleDate(item?.date);
    if (!matchId || !playedAt) return null;
    const info = item?.playInfo ?? {};
    return {
      matchId: String(matchId),
      gameType,
      playedAt,
      result: typeof info.result === "string" ? info.result : null,
      characterName: typeof info.characterName === "string" ? info.characterName : null,
      kill: Number(info.killCount) || 0,
      death: Number(info.deathCount) || 0,
      assist: Number(info.assistCount) || 0,
    };
  }
}
