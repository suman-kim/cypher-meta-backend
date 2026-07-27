/**
 * player-history.controller.ts
 * ---------------------------------------------------------------------------
 * 개인 히스토리 적립/분석 REST 컨트롤러 (프리픽스 /meta, 전역 포함 시 /api/meta).
 *
 *  - POST /meta/history/track            프로필 조회 훅(공개): watchlist 등록 + 최근분 적립
 *  - GET  /meta/history/stats            적립 현황/용량(관리자)
 *  - POST /meta/history/run-now          수동 watchlist 갱신(관리자)
 *  - POST /meta/history/:playerId/backfill  특정 플레이어 전체 백필(관리자)
 *  - GET  /meta/history/:playerId/matches   적립 원본 매치(공개, 디버그)
 *  - GET  /meta/history/:playerId        개인 분석 요약(공개)
 *
 * 라우트 선언 순서 주의: "history/stats" 는 "history/:playerId" 보다 먼저 선언해
 * playerId 로 잡히지 않게 한다.
 */
import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { PlayerHistoryService } from "./player-history.service";
import { AdminGuard } from "../analytics/admin.guard";

@Controller("meta")
export class PlayerHistoryController {
  constructor(private readonly history: PlayerHistoryService) {}

  /** 프로필 조회 훅(공개). body: { playerId, nickname? }. */
  @Post("history/track")
  track(@Body() body: { playerId?: string; nickname?: string }) {
    const pid = String(body?.playerId ?? "").trim();
    if (!pid) return { tracked: false, error: "playerId required" };
    return this.history.syncOnView(pid, body?.nickname ?? null);
  }

  /** 적립 현황/용량 통계(관리자). :playerId 보다 먼저 선언. */
  @Get("history/stats")
  @UseGuards(AdminGuard)
  stats() {
    return this.history.storageStats();
  }

  /** 수동 watchlist 갱신(관리자). */
  @Post("history/run-now")
  @UseGuards(AdminGuard)
  runNow(@Query("backfillLimit") b?: string, @Query("refreshLimit") r?: string) {
    return this.history.refreshWatchlist({
      backfillLimit: b ? Number(b) : undefined,
      refreshLimit: r ? Number(r) : undefined,
    });
  }

  /** 특정 플레이어 전체 백필(관리자). */
  @Post("history/:playerId/backfill")
  @UseGuards(AdminGuard)
  async backfill(@Param("playerId") playerId: string) {
    const ingested = await this.history.ingestFull(playerId, "rating");
    return { playerId, ingested };
  }

  /** 적립된 원본 매치(공개, 디버그). */
  @Get("history/:playerId/matches")
  matches(@Param("playerId") playerId: string, @Query("limit") limit?: string) {
    return this.history.listMatches(playerId, limit ? Number(limit) : undefined);
  }

  /** 개인 분석 요약(공개). gameType=rating(기본)|normal. */
  @Get("history/:playerId")
  summary(@Param("playerId") playerId: string, @Query("gameType") gameType?: string) {
    const gt = gameType === "normal" ? "normal" : "rating";
    return this.history.summary(playerId, gt);
  }

}
