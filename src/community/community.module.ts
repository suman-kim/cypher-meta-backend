/**
 * community.module.ts
 * ------------------------------------------------------------------
 * 커뮤니티(게시판) 기능 모듈.
 * Post/Comment 엔티티를 TypeOrmModule.forFeature 로 등록하여
 * 컨트롤러(CommunityController)와 서비스(CommunityService)에
 * 리포지토리를 주입할 수 있게 묶어 주는 NestJS 모듈이다.
 * ------------------------------------------------------------------
 */
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Comment, Post } from "../database/entities";
import { CommunityController } from "./community.controller";
import { CommunityService } from "./community.service";

/**
 * 커뮤니티 모듈.
 * Post/Comment 리포지토리를 제공하고, 커뮤니티 컨트롤러·서비스를 등록한다.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Post, Comment])],
  controllers: [CommunityController],
  providers: [CommunityService],
})
export class CommunityModule {}
