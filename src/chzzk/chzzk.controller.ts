/**
 * chzzk.controller.ts
 *
 * 치지직 '사이퍼즈' 라이브 목록을 제공하는 컨트롤러.
 * HTTP: GET /api/chzzk/lives?limit=8
 */
import { Controller, Get, Query } from "@nestjs/common";
import { ChzzkService } from "./chzzk.service";


/** /api/chzzk/* — 치지직 라이브 조회 라우트 */
@Controller("chzzk")
export class ChzzkController {
  /**
   * @param chzzk — 치지직 라이브 조회·캐싱 서비스(의존성 주입)
   */
  constructor(private readonly chzzk: ChzzkService) {}

  /**
   * 현재 진행 중인 '사이퍼즈' 라이브 목록을 반환한다.
   *
   * HTTP: GET /api/chzzk/lives?limit=8
   * @param limit — 반환할 최대 라이브 수(1~20, 기본 8)
   * @returns { lives, category, fetchedAt }
   */
  @Get("lives")
  lives(@Query("limit") limit?: string) {
    const n = Number(limit);
    return this.chzzk.getCyphersLives(Number.isFinite(n) && n > 0 ? n : 8);
  }

  /**
   * 특정 채널의 현재 라이브 HLS 재생 주소(호버 미리보기용).
   *
   * HTTP: GET /api/chzzk/live-url?channelId=xxxx
   * @param channelId — 치지직 채널 ID
   * @returns { channelId, url } — url 은 m3u8 또는 조회 실패 시 null
   */
  @Get("live-url")
  liveUrl(@Query("channelId") channelId?: string) {
    return this.chzzk.getLiveUrl(channelId ?? "");
  }

  /**
   * 사이퍼즈 관련 치지직 동영상(VOD).
   * HTTP: GET /api/chzzk/videos?sort=view|recent&limit=24
   */
  @Get("videos")
  videos(@Query("sort") sort?: string, @Query("limit") limit?: string, @Query("offset") offset?: string) {
    const s = sort === "recent" ? "recent" : "view";
    const n = Number(limit);
    const o = Number(offset);
    return this.chzzk.getCyphersVideos(
      s,
      Number.isFinite(n) && n > 0 ? n : 24,
      Number.isFinite(o) && o > 0 ? o : 0,
    );
  }
}
