/**
 * meta.module.ts
 * ---------------------------------------------------------------------------
 * 메타 통계 도메인 NestJS 모듈.
 *
 * 메타 통계 조회(MetaService)·데이터 수집(CollectorService)·스케줄링(SchedulerService)과
 * 개인 히스토리 적립(PlayerHistoryService)을 하나로 묶고, 필요한 TypeORM 엔티티
 * 리포지토리와 외부 API 프록시(NeopleModule)를 임포트한다.
 * HTTP 진입점은 MetaController(통계/수집)와 PlayerHistoryController(개인 히스토리).
 */
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Match,
  MatchPlayer,
  CollectionState,
  CollectionConfig,
  CollectionRun,
  PlayerMatch,
  TrackedPlayer,
} from "../database/entities";
import { NeopleModule } from "../neople/neople.module";
import { MetaService } from "./meta.service";
import { CollectorService } from "./collector.service";
import { CollectionConfigService } from "./collection-config.service";
import { SchedulerService } from "./scheduler.service";
import { MetaController } from "./meta.controller";
import { PlayerHistoryService } from "./player-history.service";
import { MatchSchemaService } from "./match-schema.service";
import { NecklaceService } from "./necklace.service";
import { PlayerHistoryController } from "./player-history.controller";

/**
 * 메타 통계 기능(조회·수집·스케줄)과 개인 히스토리 적립을 구성하는 기능 모듈.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Match,
      MatchPlayer,
      CollectionState,
      CollectionConfig,
      CollectionRun,
      PlayerMatch,
      TrackedPlayer,
    ]),
    NeopleModule,
  ],
  controllers: [MetaController, PlayerHistoryController],
  providers: [MetaService, CollectorService, SchedulerService, CollectionConfigService, PlayerHistoryService, MatchSchemaService, NecklaceService],
})
export class MetaModule {}
