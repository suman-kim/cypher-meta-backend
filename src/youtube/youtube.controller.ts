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

  /**
   * 사이퍼즈 관련 유튜브 동영상(VOD).
   * HTTP: GET /api/youtube/videos?sort=view|recent&limit=24
   */
  @Get("videos")
  videos(@Query("sort") sort?: string, @Query("limit") limit?: string, @Query("pageToken") pageToken?: string) {
    const s = sort === "recent" ? "recent" : "view";
    const n = Number(limit);
    return this.youtube.getCyphersVideos(s, Number.isFinite(n) && n > 0 ? n : 24, pageToken ?? "");
  }
}
