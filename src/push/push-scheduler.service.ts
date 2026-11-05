/**
 * push-scheduler.service.ts
 *
 * 푸시 주기 작업(AlertSource — 방송·전적 감지, 오래된 기기 정리) 스케줄러.
 * src/meta/scheduler.service.ts 처럼 라이브러리 없이 setTimeout 으로 돈다.
 *  - 앱이 뜬 뒤 작업마다 30~60초 늦게 첫 실행하고, 이후 각자의 intervalSec 마다 반복한다(고정 주기).
 *  - 한 작업이 아직 돌고 있으면 그 작업의 다음 틱은 건너뛴다(running 표시).
 *  - env PUSH_JOBS_ENABLED=false 면 아예 켜지 않는다(기본 켬).
 *  - Vercel(서버리스)에는 오래 사는 프로세스가 없어 메모리 타이머가 돌지 않으므로 끈다(meta 스케줄러와 같은 조건).
 * 작업 목록은 ALERT_SOURCES 로 주입받으므로, 새 알림 종류를 추가해도 이 파일은 고칠 필요가 없다.
 */
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ALERT_SOURCES, AlertSource } from "./alerts/alert-source";

/** 첫 실행 전 기본 지연(초) */
const INITIAL_DELAY_SEC = 30;
/** 작업끼리 첫 실행을 벌려 두는 간격(초) */
const STAGGER_SEC = 20;
/** 첫 실행 지연 상한(초) */
const MAX_INITIAL_DELAY_SEC = 60;

/** 푸시 주기 작업 스케줄러(감지·정리) */
@Injectable()
export class PushSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  /** 로거 */
  private readonly logger = new Logger(PushSchedulerService.name);
  /** 작업 이름별 예약 타이머 */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** 지금 실행 중인 작업 이름 */
  private readonly running = new Set<string>();
  /** 모듈 종료 여부(종료 후 재예약 방지) */
  private stopped = false;

  /**
   * @param sources — 돌릴 감지 작업 목록
   * @param env — PUSH_JOBS_ENABLED 확인용
   */
  constructor(
    @Inject(ALERT_SOURCES) private readonly sources: AlertSource[],
    private readonly env: ConfigService,
  ) {}

  /** 앱 부팅 완료 시 각 작업의 첫 실행을 예약한다 */
  onApplicationBootstrap(): void {
    if (process.env.VERCEL) {
      this.logger.log("Vercel 감지 — 푸시 주기 작업을 켜지 않습니다(메모리 타이머 불가)");
      return;
    }
    if (String(this.env.get<string>("PUSH_JOBS_ENABLED", "true")).trim().toLowerCase() === "false") {
      this.logger.log("PUSH_JOBS_ENABLED=false — 푸시 주기 작업(감지·정리)을 켜지 않습니다");
      return;
    }
    this.sources.forEach((source, i) => {
      const delaySec = Math.min(INITIAL_DELAY_SEC + i * STAGGER_SEC, MAX_INITIAL_DELAY_SEC);
      this.logger.log(`푸시 작업 '${source.name}' 예약 — ${delaySec}초 뒤 첫 실행, 이후 ${source.intervalSec}초마다`);
      this.schedule(source, delaySec * 1000);
    });
  }

  /**
   * 작업의 다음 틱을 예약한다.
   * @param source — 감지 작업
   * @param delayMs — 지연(ms)
   */
  private schedule(source: AlertSource, delayMs: number): void {
    if (this.stopped) return;
    const timer = setTimeout(() => void this.tick(source), delayMs);
    timer.unref?.();
    this.timers.set(source.name, timer);
  }

  /**
   * 한 틱: 다음 틱을 먼저 예약(고정 주기)하고, 이전 실행이 끝났을 때만 작업을 1회 실행한다.
   * @param source — 감지 작업
   */
  private async tick(source: AlertSource): Promise<void> {
    if (this.stopped) return;
    this.schedule(source, source.intervalSec * 1000);
    if (this.running.has(source.name)) {
      this.logger.warn(`푸시 작업 '${source.name}' 이전 실행이 아직 끝나지 않아 이번 틱은 건너뜁니다`);
      return;
    }
    this.running.add(source.name);
    try {
      await source.run();
    } catch (e) {
      this.logger.error(`푸시 작업 '${source.name}' 오류: ${(e as Error).message}`);
    } finally {
      this.running.delete(source.name);
    }
  }

  /** 모듈 종료 시 예약 타이머를 모두 정리한다 */
  onModuleDestroy(): void {
    this.stopped = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
