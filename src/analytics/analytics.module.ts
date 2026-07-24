/**
 * analytics.module.ts
 *
 * 방문/이벤트 트래킹 및 통계 기능을 구성하는 NestJS 모듈.
 * Visit 엔티티 리포지토리를 등록하고 컨트롤러·서비스를 묶는다.
 */
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Visit } from "../database/entities";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";

/** 애널리틱스(방문 통계) 관련 컨트롤러·서비스·엔티티를 묶는 모듈 */
@Module({
  imports: [TypeOrmModule.forFeature([Visit])], // Visit 엔티티 리포지토리 주입 등록
  controllers: [AnalyticsController], // /api/analytics/* 라우트 처리
  providers: [AnalyticsService], // 트래킹 저장·통계 집계 서비스
})
export class AnalyticsModule {}
