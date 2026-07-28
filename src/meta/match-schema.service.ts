/**
 * match-schema.service.ts
 * ---------------------------------------------------------------------------
 * match_players 확장 컬럼(itemPurchase/stats/role/roleSource)의 스키마 가드.
 *
 * 운영계는 DB_SYNC(synchronize)=false 라서 엔티티에 컬럼을 추가해도 실제 테이블에는
 * 반영되지 않는다 — 그 상태로 배포하면 TypeORM SELECT/INSERT가 "column does not exist"
 * 로 죽는다. 그래서 부팅 시 idempotent ALTER(ADD COLUMN IF NOT EXISTS)를 실행해
 * 개발계/운영계 모두 무중단으로 컬럼을 보장한다. (CollectionConfigService.ensureTables 패턴)
 * 기존 행은 전부 NULL 로 남고(소급 없음), 기존 집계 쿼리는 영향받지 않는다.
 */
import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { DataSource } from "typeorm";

/** match_players 확장 컬럼을 부팅 시 보장하는 스키마 가드. */
@Injectable()
export class MatchSchemaService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MatchSchemaService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    const ddl = [
      `ALTER TABLE match_players ADD COLUMN IF NOT EXISTS "itemPurchase" jsonb`,
      `ALTER TABLE match_players ADD COLUMN IF NOT EXISTS "stats" jsonb`,
      `ALTER TABLE match_players ADD COLUMN IF NOT EXISTS "role" varchar`,
      `ALTER TABLE match_players ADD COLUMN IF NOT EXISTS "roleSource" varchar`,
    ];
    try {
      for (const q of ddl) await this.dataSource.query(q);
      this.logger.log("match_players 확장 컬럼 보장 완료(itemPurchase/stats/role/roleSource)");
    } catch (e) {
      // 실패해도 앱은 뜨게 두되 크게 로그 — 이 상태에서 수집이 돌면 insert 가 실패할 수 있다.
      this.logger.error(`match_players 컬럼 보장 실패: ${(e as Error).message}`);
    }
  }
}
