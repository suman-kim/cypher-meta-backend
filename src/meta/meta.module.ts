/**
 * meta.module.ts
 * ---------------------------------------------------------------------------
 * 메타 통계 도메인 NestJS 모듈.
 *
 * 메타 통계 조회(MetaService)·데이터 수집(CollectorService)·스케줄링(SchedulerService)을
 * 하나로 묶고, 필요한 TypeORM 엔티티 리포지토리(Match, MatchPlayer, CollectionState)와
 * 외부 API 프록시(NeopleModule)를 임포트한다. HTTP 진입점은 MetaController.
 */
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Match, MatchPlayer, CollectionState, CollectionConfig, CollectionRun } from "../database/entities";
import { NeopleModule } from "../neople/neople.module";
import { MetaService } from "./meta.service";
import { CollectorService } from "./collector.service";
import { CollectionConfigService } from "./collection-config.service";
import { SchedulerService } from "./scheduler.service";
import { MetaController } from "./meta.controller";

/**
 * 메타 통계 기능(조회·수집·스케줄)을 구성하는 기능 모듈.
 * - imports: 사용 엔티티 리포지토리 등록(forFeature) 및 네오플 API 모듈.
 * - controllers: 메타 관련 HTTP 라우트 처리(MetaController).
 * - providers: 통계/수집/스케줄러 서비스.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Match, MatchPlayer, CollectionState, CollectionConfig, CollectionRun]), NeopleModule],
  controllers: [MetaController],
  providers: [MetaService, CollectorService, SchedulerService, CollectionConfigService],
})
export class MetaModule {}
