/**
 * votes.module.ts
 * ------------------------------------------------------------------
 * 투표(티어/조합) 기능 모듈.
 * Vote·CharacterUltimate(공식 역할군 투표 검증용) 엔티티를 TypeOrmModule.forFeature 로 등록하여
 * 컨트롤러(VotesController)와 서비스(VotesService)에 리포지토리를
 * 주입할 수 있게 묶어 주는 NestJS 모듈이다.
 * ------------------------------------------------------------------
 */
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CharacterUltimate, Vote } from "../database/entities";
import { VotesService } from "./votes.service";
import { VotesController } from "./votes.controller";

/**
 * 투표 모듈.
 * Vote 리포지토리를 제공하고, 투표 컨트롤러·서비스를 등록한다.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Vote, CharacterUltimate])],
  controllers: [VotesController],
  providers: [VotesService],
})
export class VotesModule {}
