/**
 * analytics.controller.ts
 *
 * 방문/이벤트 트래킹과 관리자용 통계 조회를 담당하는 HTTP 컨트롤러.
 * 전역 prefix("api")가 적용되므로 실제 경로는 /api/analytics/* 이다.
 * - track: 공개 엔드포인트(방문 기록 수집)
 * - admin/stats, admin/recent: AdminGuard 로 보호되는 관리자 전용 엔드포인트
 */
import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import { AdminGuard } from "./admin.guard";
import { TrackDto } from "./dto";

/**
 * 트래킹/통계 관련 라우트를 모아둔 컨트롤러. 실제 로직은 AnalyticsService 에 위임한다.
 * 베이스 경로: /api/analytics
 */
@Controller("analytics")
export class AnalyticsController {
  /**
   * @param svc — 트래킹 저장 및 통계 집계를 수행하는 서비스(의존성 주입)
   */
  constructor(private readonly svc: AnalyticsService) {}

  /**
   * 방문/이벤트 기록 (공개). 프론트 /api/track 프록시가 IP·geo·UA 를 채워 보냄.
   *
   * HTTP: POST /api/analytics/track
   * @param dto — 기록할 방문/이벤트 정보(경로·이벤트·리퍼러·방문자ID 등)
   * @returns 저장 성공 여부 객체 { ok: boolean }
   */
  @Post("track")
  track(@Body() dto: TrackDto) {
    return this.svc.track(dto);
  }

  /**
   * 통계 집계 (관리자)
   *
   * HTTP: GET /api/analytics/admin/stats  (AdminGuard 필요)
   * @param days — 집계 대상 기간(일). 문자열 쿼리, 미지정 시 30. 서비스에서 1~365로 보정.
   * @returns 기간·총계·일자별·인기 페이지/검색어/리퍼러·국가·기기·브라우저·시간대·이벤트·OS 통계 묶음
   */
  @UseGuards(AdminGuard)
  @Get("admin/stats")
  stats(@Query("days") days?: string) {
    return this.svc.stats(days ? Number(days) : 30);
  }

  /**
   * 최근 방문 로그 (관리자)
   *
   * HTTP: GET /api/analytics/admin/recent  (AdminGuard 필요)
   * @param limit — 가져올 최근 로그 개수. 문자열 쿼리, 미지정 시 50. 서비스에서 1~200으로 보정.
   * @returns 최신순 방문 로그 배열(생성시각·이벤트·경로·검색어·리퍼러·지역·기기·브라우저·OS·IP)
   */
  @UseGuards(AdminGuard)
  @Get("admin/recent")
  recent(@Query("limit") limit?: string) {
    return this.svc.recent(limit ? Number(limit) : 50);
  }
}
