/**
 * 자동 메타 수집 스케줄러 파일.
 *
 * 별도 스케줄링 라이브러리 없이 setTimeout 만으로 CollectorService 를 주기적으로 호출한다.
 * 백엔드 부팅 직후(초기 지연 후) 최초 1회 수집하고, 이후 설정된 시간 간격마다 반복한다.
 *
 * 수집 동작값(on/off·주기·모드·랭커 수 등)은 이제 env 가 아니라 DB(collection_config)에서
 * 매 사이클마다 읽는다. 따라서 관리자 UI 에서 설정을 바꾸면 백엔드 재시작 없이 다음 사이클에 반영된다.
 * (env 는 최초 시딩과 부팅 지연/네오플 키 확인 용도로만 남는다.)
 *
 * Vercel 서버리스 환경에서는 장기 실행 프로세스가 없어 인메모리 타이머가 동작하지 않으므로
 * 스케줄러를 비활성화하고 Vercel Cron(/api/meta/cron/collect) 에 위임한다.
 */
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CollectorService } from "./collector.service";
import { CollectionConfigService } from "./collection-config.service";

/**
 * 자동 메타 수집 스케줄러 (무의존성 — setTimeout 기반, DB 설정 구동).
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  /**
   * 의존성 주입.
   * @param collector — 실제 수집을 수행하는 CollectorService.
   * @param collectionConfig — 수집 설정(DB) 서비스 — on/off·주기·모드 등을 읽는다.
   * @param env — 부팅 지연·네오플 키 확인용 ConfigService(.env).
   */
  constructor(
    private readonly collector: CollectorService,
    private readonly collectionConfig: CollectionConfigService,
    private readonly env: ConfigService,
  ) {}

  /**
   * 애플리케이션 부팅 완료 시 NestJS 가 호출하는 훅.
   * Vercel 환경이면 인메모리 스케줄러를 비활성화하고 Cron 에 위임한다. 그 외에는 초기 지연 후
   * 첫 사이클(tick)을 예약한다. 이후 각 사이클은 DB 설정의 주기로 스스로 다음 사이클을 잡는다.
   */
  onApplicationBootstrap() {
    if (process.env.VERCEL) {
      this.logger.log("Vercel 감지 — 인메모리 스케줄러 비활성(Cron 사용: /api/meta/cron/collect)");
      return;
    }
    const initialDelaySec = this.numEnv("META_COLLECT_INITIAL_DELAY_SEC", 30, 0);

    const key = this.env.get<string>("NEOPLE_API_KEY");
    if (!key || key.includes("여기에")) {
      this.logger.warn(
        "NEOPLE_API_KEY 미설정 — 자동 수집은 예약되지만 실제 호출은 실패합니다. .env 를 확인하세요.",
      );
    }

    this.logger.log(`자동 수집 스케줄러 시작 — 최초 ${initialDelaySec}s 후 첫 사이클(설정은 DB에서 로드)`);
    this.timer = setTimeout(() => void this.tick(), initialDelaySec * 1000);
    this.timer.unref?.();
  }

  /**
   * 한 사이클: 수집을 1회 시도한 뒤, 현재 DB 설정의 주기로 다음 사이클을 예약한다.
   * autoCollect 가 꺼져 있어도 사이클 자체는 계속 돌아(재예약), 관리자가 켜면 재시작 없이 재개된다.
   */
  private async tick(): Promise<void> {
    if (this.stopped) return;
    let intervalHours = 6;
    try {
      await this.run();
    } catch (e) {
      this.logger.error(`자동 수집 사이클 오류: ${(e as Error).message}`);
    }
    try {
      const cfg = await this.collectionConfig.getConfig();
      intervalHours = cfg.intervalHours >= 0.1 ? cfg.intervalHours : 6;
    } catch {
      /* 설정 조회 실패 시 기본 6h 로 재예약 */
    }
    if (this.stopped) return;
    const ms = Math.max(intervalHours, 0.1) * 60 * 60 * 1000;
    this.timer = setTimeout(() => void this.tick(), ms);
    this.timer.unref?.();
  }

  /**
   * DB 설정을 읽어 1회 수집을 실행한다. autoCollect 가 false 면 건너뛴다.
   * mode 에 따라 회전(collectRotating) 또는 고정(collect) 수집을 자동/interval 트리거로 수행한다.
   */
  private async run(): Promise<void> {
    const cfg = await this.collectionConfig.getConfig();
    if (!cfg.autoCollect) {
      this.logger.log("자동 수집 off(config) — 이번 사이클 건너뜀");
      return;
    }
    if (cfg.mode === "rotating") {
      this.logger.log(
        `자동 수집(회전) 시작 window=${cfg.cronWindow} maxRank=${cfg.maxRank} perPlayer=${cfg.perPlayer} game=${cfg.gameType}`,
      );
      const res = await this.collector.collectRotating(
        { window: cfg.cronWindow, perPlayer: cfg.perPlayer, gameTypeId: cfg.gameType, maxRank: cfg.maxRank },
        { trigger: "auto", source: "interval" },
      );
      this.logger.log(`자동 수집(회전) 완료: ${JSON.stringify(res)}`);
    } else {
      this.logger.log(
        `자동 수집(고정) 시작 rankers=${cfg.rankers} perPlayer=${cfg.perPlayer} game=${cfg.gameType}`,
      );
      const res = await this.collector.collect(
        { rankers: cfg.rankers, perPlayer: cfg.perPlayer, gameTypeId: cfg.gameType, offset: 0, mode: "fixed" },
        { trigger: "auto", source: "interval" },
      );
      this.logger.log(`자동 수집(고정) 완료: ${JSON.stringify(res)}`);
    }
  }

  /**
   * 숫자 env 파싱 (유효하지 않으면 기본값, 최소값 하한).
   * @param key — 읽을 환경변수 키.
   * @param fallback — 없거나 유효하지 않을 때 기본값.
   * @param min — 허용 최소값.
   */
  private numEnv(key: string, fallback: number, min: number): number {
    const n = Number(this.env.get<string>(key, String(fallback)));
    return Number.isFinite(n) && n >= min ? n : fallback;
  }

  /** 모듈 소멸 시 예약 타이머를 정리한다. */
  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
