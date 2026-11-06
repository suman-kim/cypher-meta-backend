/**
 * moderation.controller.ts — 신고 API.
 *  - POST /moderation/reports                : 신고 넣기(누구나)
 *  - GET  /moderation/admin/reports          : 대상별 신고 목록(관리자)
 *  - POST /moderation/admin/reports/resolve  : 신고 처리(관리자)
 * 라우팅·바인딩만 하고 로직은 ModerationService 에 맡긴다.
 */
import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { AdminGuard } from "../analytics/admin.guard";
import { AdminReportsQuery, CreateReportDto, ResolveReportDto } from "./dto";
import { ModerationService } from "./moderation.service";

/** 신고 컨트롤러 */
@Controller("moderation")
export class ModerationController {
  /**
   * @param svc — 신고 서비스 (DI 주입)
   */
  constructor(private readonly svc: ModerationService) {}

  /**
   * 신고를 넣는다.
   * @param dto — 대상·사유·상세·신고자 임의 ID
   * @returns { ok, duplicate }
   */
  @Post("reports")
  report(@Body() dto: CreateReportDto) {
    return this.svc.report(dto);
  }

  /**
   * 관리자용 신고 목록(대상별 묶음).
   * @param q — 보기(pending/handled)·페이지·페이지 크기
   * @returns 묶음 페이지와 대기 대상 수
   */
  @UseGuards(AdminGuard)
  @Get("admin/reports")
  adminList(@Query() q: AdminReportsQuery) {
    return this.svc.adminList(q);
  }

  /**
   * 관리자용 신고 처리.
   * @param dto — 대상·처리 방법·닉네임 작성 제한 여부
   * @returns 처리 결과
   */
  @UseGuards(AdminGuard)
  @Post("admin/reports/resolve")
  resolve(@Body() dto: ResolveReportDto) {
    return this.svc.resolve(dto);
  }
}
