/**
 * analytics.controller.ts
 *
 * 방문/이벤트 트래킹과 관리자용 통계 조회를 담당하는 HTTP 컨트롤러.
 * 전역 prefix("api")가 적용되므로 실제 경로는 /api/analytics/* 이다.
 * - track: 공개 엔드포인트(방문 기록 수집)
 * - admin/stats, admin/recent: 관리자 요약 통계·최근 방문
 * - admin/daily, admin/day, admin/logs, admin/visitor: 관리자 일별 표·하루 상세·방문 로그·방문자 요약
 * - admin/activity, admin/activity/summary: 관리자 사이트 활동 목록·하루별 요약
 * admin/* 는 모두 AdminGuard(x-admin-token)로 보호한다.
 */
import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsReportService } from "./analytics-report.service";
import { ActivityService } from "./activity/activity.service";
import { AdminGuard } from "./admin.guard";
import { ActivityQuery, DayQuery, DaysQuery, LogsQuery, TrackDto, VisitorQuery } from "./dto";

/**
 * 트래킹/통계 관련 라우트를 모아둔 컨트롤러. 실제 로직은 AnalyticsService 에 위임한다.
 * 베이스 경로: /api/analytics
 */
@Controller("analytics")
export class AnalyticsController {
  /**
   * @param svc — 트래킹 저장 및 요약 통계 집계를 수행하는 서비스(의존성 주입)
   * @param report — 일별 표·하루 상세·방문 로그·방문자 요약 조회 서비스
   * @param activity — 사이트 활동 목록·요약 서비스
   */
  constructor(
    private readonly svc: AnalyticsService,
    private readonly report: AnalyticsReportService,
    private readonly activity: ActivityService,
  ) {}

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

  /**
   * 일별 표 (관리자) — 날짜별 조회수·방문자·새 방문자·검색·앱/웹 + 화면 종류별 조회수
   *
   * HTTP: GET /api/analytics/admin/daily?days=30  (AdminGuard 필요)
   * @param q.days — 최근 며칠(오늘 포함, 1~120, 기본 30)
   * @returns { range, groups, rows }
   */
  @UseGuards(AdminGuard)
  @Get("admin/daily")
  daily(@Query() q: DaysQuery) {
    return this.report.daily(q.days);
  }

  /**
   * 하루 상세 (관리자) — 페이지·검색어·유입·시간대·이벤트·화면 종류
   *
   * HTTP: GET /api/analytics/admin/day?date=YYYY-MM-DD  (AdminGuard 필요)
   * @param q.date — 볼 날짜(KST)
   * @returns 그날 상세
   */
  @UseGuards(AdminGuard)
  @Get("admin/day")
  day(@Query() q: DayQuery) {
    return this.report.day(q.date);
  }

  /**
   * 방문 로그 (관리자) — 필터·키셋 커서 페이지 넘김
   *
   * HTTP: GET /api/analytics/admin/logs?from&to&event&text&device&client&visitorId&bots&cursor&limit  (AdminGuard 필요)
   * @param q — 필터·커서·건수
   * @returns { range, items, nextCursor, events? }
   */
  @UseGuards(AdminGuard)
  @Get("admin/logs")
  logs(@Query() q: LogsQuery) {
    return this.report.logs(q);
  }

  /**
   * 방문자 요약 (관리자)
   *
   * HTTP: GET /api/analytics/admin/visitor?visitorId=  (AdminGuard 필요)
   * @param q.visitorId — 방문자 ID
   * @returns 첫·마지막 방문, 조회 수, 앱/웹, 최근 기기, 자주 본 화면
   */
  @UseGuards(AdminGuard)
  @Get("admin/visitor")
  visitor(@Query() q: VisitorQuery) {
    return this.report.visitor(q.visitorId);
  }

  /**
   * 사이트 활동 목록 (관리자) — 글·댓글·신고·투표·코스튬 제보·알림 기기를 최신순으로
   *
   * HTTP: GET /api/analytics/admin/activity?types&before&limit  (AdminGuard 필요)
   * @param q — 종류·기준 시각·건수
   * @returns { items, nextBefore, types }
   */
  @UseGuards(AdminGuard)
  @Get("admin/activity")
  activityList(@Query() q: ActivityQuery) {
    return this.activity.list(q);
  }

  /**
   * 사이트 활동 하루별 요약 (관리자)
   *
   * HTTP: GET /api/analytics/admin/activity/summary?days=30  (AdminGuard 필요)
   * @param q.days — 최근 며칠(1~120, 기본 30)
   * @returns { range, types, rows }
   */
  @UseGuards(AdminGuard)
  @Get("admin/activity/summary")
  activitySummary(@Query() q: DaysQuery) {
    return this.activity.summary(q.days);
  }
}
