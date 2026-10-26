/**
 * community.module.ts
 * ------------------------------------------------------------------
 * 커뮤니티(게시판) 기능 모듈.
 * Post/Comment/BannedWord 엔티티를 TypeOrmModule.forFeature 로 등록하여
 * 컨트롤러(CommunityController)와 서비스(CommunityService, BannedWordService)에
 * 리포지토리를 주입할 수 있게 묶어 주는 NestJS 모듈이다.
 * BannedWordService 는 업데이트 노트 댓글 검사에도 쓰이도록 export 한다.
 * ------------------------------------------------------------------
 */
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BannedWord, Comment, Post } from "../database/entities";
import { BannedWordService } from "./banned-word.service";
import { CommunityController } from "./community.controller";
import { CommunityService } from "./community.service";

/**
 * 커뮤니티 모듈.
 * Post/Comment/BannedWord 리포지토리를 제공하고, 커뮤니티 컨트롤러·서비스와 금칙어 서비스를 등록한다.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Post, Comment, BannedWord])],
  controllers: [CommunityController],
  providers: [CommunityService, BannedWordService],
  exports: [BannedWordService],
})
export class CommunityModule {}
