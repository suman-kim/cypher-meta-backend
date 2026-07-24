/**
 * costumes.module.ts
 * ------------------------------------------------------------------
 * 코스튬 카탈로그 기능 모듈.
 * Costume 엔티티를 TypeOrmModule.forFeature 로 등록해 컨트롤러/서비스에
 * 리포지토리를 주입할 수 있게 묶어 주는 NestJS 모듈이다.
 * ------------------------------------------------------------------
 */
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Costume, CostumeFeedback } from "../database/entities";
import { CostumesService } from "./costumes.service";
import { CostumesController } from "./costumes.controller";

/** 코스튬 모듈 — 리포지토리 제공 + 컨트롤러/서비스 등록. */
@Module({
  imports: [TypeOrmModule.forFeature([Costume, CostumeFeedback])],
  controllers: [CostumesController],
  providers: [CostumesService],
})
export class CostumesModule {}
