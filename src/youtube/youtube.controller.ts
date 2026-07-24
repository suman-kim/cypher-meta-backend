/**
 * youtube.controller.ts
 *
 * 유튜브 '사이퍼즈' 라이브 목록 제공.
 * HTTP: GET /api/youtube/lives?limit=12
 */
import { Controller, Get, Query } from "@nestjs/common";
import { YoutubeService } from "./youtube.service";

/** /api/youtube/* — 유튜브 라이브 조회 라우트 */
@Controller("youtube")
export class YoutubeController {
  constructor(private readonly youtube: YoutubeService) {}

  /**
   * 현재 진행 중인 유튜브 '사이퍼즈' 라이브 목록.
   * HTTP: GET /api/youtube/lives?limit=12
   */
  @Get("lives")
  lives(@Query("limit") limit?: string) {
    const n = Number(limit);
    return this.youtube.getCyphersLives(Number.isFinite(n) && n > 0 ? n : 12);
  }
}
