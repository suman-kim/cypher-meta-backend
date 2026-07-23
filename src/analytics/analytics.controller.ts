import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import { AdminGuard } from "./admin.guard";
import { TrackDto } from "./dto";

@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly svc: AnalyticsService) {}

  /** 방문/이벤트 기록 (공개). 프론트 /api/track 프록시가 IP·geo·UA 를 채워 보냄. */
  @Post("track")
  track(@Body() dto: TrackDto) {
    return this.svc.track(dto);
  }

  /** 통계 집계 (관리자) */
  @UseGuards(AdminGuard)
  @Get("admin/stats")
  stats(@Query("days") days?: string) {
    return this.svc.stats(days ? Number(days) : 30);
  }

  /** 최근 방문 로그 (관리자) */
  @UseGuards(AdminGuard)
  @Get("admin/recent")
  recent(@Query("limit") limit?: string) {
    return this.svc.recent(limit ? Number(limit) : 50);
  }
}
