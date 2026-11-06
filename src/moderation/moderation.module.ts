/**
 * moderation.module.ts — 사용자 신고(Google Play 사용자 제작 콘텐츠 정책 대응) 모듈.
 * 신고 대상 도메인(커뮤니티·업데이트 노트)의 서비스를 가져와 대상 종류별 처리(ReportTarget)에 쓴다.
 */
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Comment, ContentReport, Post, UpdateComment, UpdateNote } from "../database/entities";
import { CommunityModule } from "../community/community.module";
import { UpdatesModule } from "../updates/updates.module";
import { ModerationController } from "./moderation.controller";
import { ModerationService } from "./moderation.service";
import {
  CommentReportTarget,
  PostReportTarget,
  ReportTargetRegistry,
  UpdateCommentReportTarget,
} from "./report-targets";

/** 신고 모듈 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ContentReport, Post, Comment, UpdateComment, UpdateNote]),
    CommunityModule,
    UpdatesModule,
  ],
  controllers: [ModerationController],
  providers: [ModerationService, ReportTargetRegistry, PostReportTarget, CommentReportTarget, UpdateCommentReportTarget],
})
export class ModerationModule {}
