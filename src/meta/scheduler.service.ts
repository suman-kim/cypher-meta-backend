import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CollectorService } from "./collector.service";

/**
 * 자동 메타 수집 스케줄러 (무의존성 — setTimeout/setInterval 기반).
 *
 * 백엔드 부팅 후 최초 1회 수집하고, 이후 N시간마다 자동 수집합니다.
 * 모든 동작은 .env 로 조절 가능하며, CollectorService 의 running 가드로 중복 실행을 막습니다.
 *
 * .env:
 *   META_AUTO_COLLECT           자동 수집 on/off (기본 true)
 *   META_COLLECT_INTERVAL_HOURS 주기(시간, 기본 6)
 *   META_COLLECT_INITIAL_DELAY_SEC 부팅 후 최초 수집까지 지연(초, 기본 30)
 *   META_COLLECT_RANKERS        수집 대상 상위 랭커 수 (기본 20)
 *   META_COLLECT_PER_PLAYER     플레이어당 매치 수 (기본 10)
 *   META_COLLECT_GAME_TYPE      게임 타입 (기본 rating)
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly collector: CollectorService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    // Vercel serverless: no long-lived process, so setInterval never fires.
    // Disable the in-memory scheduler there and rely on Vercel Cron
    // (vercel.json -> /api/meta/cron/collect) instead.
    if (process.env.VERCEL) {
      this.logger.log("Vercel 감지 — 인메모리 스케줄러 비활성(Cron 사용: /api/meta/cron/collect)");
      return;
    }
    const enabled = this.config.get<string>("META_AUTO_COLLECT", "true") !== "false";
    if (!enabled) {
      this.logger.log("자동 수집 비활성화 (META_AUTO_COLLECT=false)");
      return;
    }

    const intervalHours = this.num("META_COLLECT_INTERVAL_HOURS", 6, 0.1);
    const initialDelaySec = this.num("META_COLLECT_INITIAL_DELAY_SEC", 30, 0);
    const intervalMs = intervalHours * 60 * 60 * 1000;

    const key = this.config.get<string>("NEOPLE_API_KEY");
    if (!key || key.includes("여기에")) {
      this.logger.warn(
        "NEOPLE_API_KEY 미설정 — 자동 수집은 예약되지만 실제 호출은 실패합니다. .env 를 확인하세요.",
      );
    }

    this.logger.log(
      `자동 수집 활성화 — 최초 ${initialDelaySec}s 후 실행, 이후 ${intervalHours}h 주기`,
    );

    this.bootTimer = setTimeout(() => {
      void this.run();
      this.intervalTimer = setInterval(() => void this.run(), intervalMs);
      this.intervalTimer.unref?.();
    }, initialDelaySec * 1000);
    this.bootTimer.unref?.();
  }

  private async run() {
    const opts = {
      rankers: this.num("META_COLLECT_RANKERS", 20, 1),
      perPlayer: this.num("META_COLLECT_PER_PLAYER", 10, 1),
      gameTypeId: this.config.get<string>("META_COLLECT_GAME_TYPE", "rating"),
    };
    try {
      this.logger.log(
        `자동 수집 시작 rankers=${opts.rankers} perPlayer=${opts.perPlayer} gameType=${opts.gameTypeId}`,
      );
      const res = await this.collector.collect(opts);
      this.logger.log(`자동 수집 완료: ${JSON.stringify(res)}`);
    } catch (e) {
      this.logger.error(`자동 수집 실패: ${(e as Error).message}`);
    }
  }

  /** 숫자 env 파싱 (유효하지 않으면 기본값, 최소값 하한) */
  private num(key: string, fallback: number, min: number): number {
    const n = Number(this.config.get<string>(key, String(fallback)));
    return Number.isFinite(n) && n >= min ? n : fallback;
  }

  onModuleDestroy() {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.bootTimer = null;
    this.intervalTimer = null;
  }
}
