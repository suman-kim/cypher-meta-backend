/**
 * collection-config.service.ts
 * ---------------------------------------------------------------------------
 * 메타 수집 "설정"의 DB 진실원본(source of truth)을 관리하는 서비스.
 *
 * - 부팅 시 collection_config / collection_run 테이블을 idempotent 하게 생성한다
 *   (DB_SYNC(synchronize) 설정과 무관하게 동작 — 개발계/운영계 모두 안전).
 * - config 행이 없으면 기존 env(META_*) 값으로 최초 1회 시딩한다.
 *   이후에는 이 테이블이 진실원본이며, env 는 시드/폴백 용도로만 남는다.
 * - 설정 조회(getConfig)·수정(updateConfig)·회전 커서 전진(setCursor)을 제공한다.
 */
import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository, Table } from "typeorm";
import { CollectionConfig, CollectionRun } from "../database/entities";

/** 설정 수정 시 허용되는 부분 갱신 필드. */
export interface CollectionConfigPatch {
  autoCollect?: boolean;
  intervalHours?: number;
  mode?: string;
  rankers?: number;
  perPlayer?: number;
  gameType?: string;
  cronWindow?: number;
  maxRank?: number;
  cursorOffset?: number;
}

const CONFIG_ID = "default";
const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

@Injectable()
export class CollectionConfigService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CollectionConfigService.name);
  private readyPromise: Promise<void> | null = null;

  constructor(
    @InjectRepository(CollectionConfig) private readonly repo: Repository<CollectionConfig>,
    private readonly dataSource: DataSource,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.ensureReady();
      this.logger.log("collection_config/collection_run 준비 완료");
    } catch (e) {
      this.logger.error(`수집 설정 초기화 실패: ${(e as Error).message}`);
    }
  }

  /** 테이블 생성 + 시딩을 최초 1회만 수행(동시 호출 안전). */
  private ensureReady(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        await this.ensureTables();
        await this.seedIfEmpty();
      })();
    }
    return this.readyPromise;
  }

  /** collection_config / collection_run 테이블을 엔티티 메타데이터로 idempotent 생성. */
  private async ensureTables(): Promise<void> {
    const qr = this.dataSource.createQueryRunner();
    try {
      await qr.connect();
      for (const Entity of [CollectionConfig, CollectionRun]) {
        const meta = this.dataSource.getMetadata(Entity);
        if (!(await qr.hasTable(meta.tableName))) {
          await qr.createTable(Table.create(meta, this.dataSource.driver), true, false, true);
          this.logger.log(`테이블 생성: ${meta.tableName}`);
        }
      }
    } finally {
      await qr.release();
    }
  }

  /** config 행이 없으면 env 값으로 최초 시딩. 현재 환경의 기존 동작을 최대한 보존한다. */
  private async seedIfEmpty(): Promise<void> {
    const exists = await this.repo.findOne({ where: { id: CONFIG_ID } });
    if (exists) return;

    const env = process.env;
    const num = (k: string, d: number): number => {
      const n = Number(env[k]);
      return Number.isFinite(n) ? n : d;
    };
    const bool = (k: string, d: boolean): boolean => {
      const v = env[k];
      return v == null ? d : v !== "false";
    };
    // 운영계(Vercel Cron·META_CRON_MAX_RANK 설정)는 회전, 그 외(로컬 스케줄러)는 고정 상위N —
    // 시드 시점의 기존 동작을 보존한다. 이후 관리자 UI 에서 자유롭게 변경 가능.
    const rotating = env.META_CRON_MAX_RANK != null || !!env.VERCEL;

    const seeded = this.repo.create({
      id: CONFIG_ID,
      autoCollect: bool("META_AUTO_COLLECT", true),
      intervalHours: num("META_COLLECT_INTERVAL_HOURS", 6),
      mode: rotating ? "rotating" : "fixed",
      rankers: num("META_COLLECT_RANKERS", 20),
      perPlayer: num("META_COLLECT_PER_PLAYER", 10),
      gameType: env.META_COLLECT_GAME_TYPE ?? "rating",
      cronWindow: num("META_CRON_WINDOW", 10),
      maxRank: num("META_CRON_MAX_RANK", 500),
      cursorOffset: 0,
    });
    await this.repo.save(seeded);
    this.logger.log(`수집 설정 최초 시딩(env 기준, mode=${seeded.mode})`);
  }

  /** 현재 설정 조회(없으면 시딩 후 반환). */
  async getConfig(): Promise<CollectionConfig> {
    await this.ensureReady();
    return this.repo.findOneOrFail({ where: { id: CONFIG_ID } });
  }

  /** 설정 부분 수정(검증·클램프 후 저장). 변경된 설정을 반환. */
  async updateConfig(patch: CollectionConfigPatch): Promise<CollectionConfig> {
    const cfg = await this.getConfig();

    if (patch.autoCollect != null) cfg.autoCollect = !!patch.autoCollect;
    if (patch.intervalHours != null) {
      const h = Number(patch.intervalHours);
      if (Number.isFinite(h) && h >= 0.1) cfg.intervalHours = h;
    }
    if (patch.mode != null) {
      const m = String(patch.mode);
      if (m === "rotating" || m === "fixed") cfg.mode = m;
    }
    if (patch.rankers != null) cfg.rankers = clampInt(patch.rankers, 1, 1000, cfg.rankers);
    if (patch.perPlayer != null) cfg.perPlayer = clampInt(patch.perPlayer, 1, 30, cfg.perPlayer);
    if (patch.gameType != null && String(patch.gameType).trim()) cfg.gameType = String(patch.gameType).trim();
    if (patch.cronWindow != null) cfg.cronWindow = clampInt(patch.cronWindow, 1, 100, cfg.cronWindow);
    if (patch.maxRank != null) cfg.maxRank = clampInt(patch.maxRank, 1, 100000, cfg.maxRank);
    // maxRank 는 최소 window 이상이어야 회전이 성립한다.
    if (cfg.maxRank < cfg.cronWindow) cfg.maxRank = cfg.cronWindow;
    if (patch.cursorOffset != null) cfg.cursorOffset = clampInt(patch.cursorOffset, 0, 100000, cfg.cursorOffset);

    return this.repo.save(cfg);
  }

  /** 회전 커서만 갱신(수집 완료 후 다음 시작 오프셋 저장). */
  async setCursor(nextOffset: number): Promise<void> {
    await this.ensureReady();
    await this.repo.update({ id: CONFIG_ID }, { cursorOffset: Math.max(0, Math.floor(nextOffset) || 0) });
  }
}
