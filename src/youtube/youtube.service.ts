/**
 * youtube.service.ts
 *
 * 유튜브에서 현재 진행 중인 '사이퍼즈' 라이브를 YouTube Data API v3 로 조회하는 서비스.
 *   1) search.list (type=video, eventType=live, q=사이퍼즈) → videoId 목록
 *   2) videos.list (liveStreamingDetails) → 동시 시청자수 등 상세
 *   3) 제목/채널에 '사이퍼즈|cyphers' 포함하는 것만 필터(다른 게임 방송 배제)
 *
 * ⚠️ search.list 는 호출당 100 유닛(일 기본 쿼터 10,000)이라, 기본 15분 캐시로 호출을 억제한다.
 * 유튜브엔 게임 카테고리 필터가 없어 검색어 기반이라 정확도는 치지직보다 낮다.
 */
import { HttpException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CacheService } from "../neople/cache.service";

const SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";
const CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels";
const QUERY = "사이퍼즈";
const KEYWORDS = ["사이퍼즈", "cyphers"]; // 제목/채널 필터 키워드(소문자 비교)
const CACHE_KEY = "youtube:cyphers-lives-v2";
const DEFAULT_TTL = 900; // 15분 — 쿼터 절약
const EMPTY_TTL = 300; // 5분(빈 결과)
const VIDEOS_TTL = 60 * 60 * 24; // 24시간 — VOD 페이지를 하루 1회만 검색(쿼터 절약). 빈 페이지는 EMPTY_TTL(짧게).
const FETCH_TIMEOUT_MS = 8000;

/** 표준 유튜브 라이브 DTO */
export interface YoutubeLive {
  liveId: string;
  title: string;
  thumbnailUrl: string | null;
  concurrentUserCount: number;
  channelId: string;
  channelName: string;
  channelImageUrl: string | null;
  openDate: string | null;
  url: string;
}

export interface YoutubeLivesResult {
  lives: YoutubeLive[];
  fetchedAt: string;
  debug?: Record<string, unknown>;
}

/** 유튜브 사이퍼즈 동영상(VOD) DTO */
export interface YoutubeVideo {
  videoId: string;
  title: string;
  thumbnailUrl: string | null;
  viewCount: number;
  publishedAt: string | null;
  durationSec: number | null;
  channelId: string;
  channelName: string;
  channelImageUrl: string | null;
  url: string;
}

/** ISO8601 재생시간(PT#H#M#S) → 초 */
function parseISODuration(iso: unknown): number | null {
  if (typeof iso !== "string") return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/**
 * 유튜브 '사이퍼즈' 라이브 조회·정규화·캐싱 서비스.
 */
@Injectable()
export class YoutubeService {
  private readonly logger = new Logger(YoutubeService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly cache: CacheService,
  ) {}

  /** YOUTUBE_API_KEY(미설정/플레이스홀더면 null) */
  private key(): string | null {
    const k = this.config.get<string>("YOUTUBE_API_KEY");
    if (!k || k.includes("여기에")) return null;
    return k;
  }

  /** 캐시 TTL(초) — env 로 조정 가능 */
  private ttl(): number {
    const t = Number(this.config.get("YOUTUBE_TTL_SEC"));
    return Number.isFinite(t) && t > 0 ? t : DEFAULT_TTL;
  }

  /** 공통 fetch(타임아웃 + JSON). !ok/비 JSON 이면 예외. */
  private async getJson(url: string): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (e) {
      throw new HttpException(
        { error: { code: "UPSTREAM_UNREACHABLE", message: "YouTube API 연결 실패", detail: (e as Error).message } },
        503,
      );
    }
    const text = await res.text();
    let body: Record<string, unknown>;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new HttpException({ error: { code: "PARSE_ERROR", message: "YouTube 응답 파싱 실패" } }, 502);
    }
    if (!res.ok) {
      // 쿼터 초과 등 유튜브 에러 메시지를 그대로 전파(상위에서 로깅)
      const msg =
        ((body?.error as Record<string, unknown>)?.message as string) ?? `YouTube API 오류(${res.status})`;
      throw new HttpException({ error: { code: "YOUTUBE_ERROR", message: msg } }, res.status);
    }
    return body;
  }

  /** 제목/채널명에 사이퍼즈 키워드가 있는지 */
  private isCyphers(...parts: string[]): boolean {
    const hay = parts.join(" ").toLowerCase();
    return KEYWORDS.some((k) => hay.includes(k.toLowerCase()));
  }

  /** 채널 아바타(썸네일) 일괄 조회. channels.list = 1유닛(배치 최대 50). */
  private async channelImages(channelIds: string[], apiKey: string): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const ids = Array.from(new Set(channelIds.filter(Boolean))).slice(0, 50);
    if (!ids.length) return map;
    try {
      const cp = new URLSearchParams({ part: "snippet", id: ids.join(","), key: apiKey });
      const r = (await this.getJson(`${CHANNELS_URL}?${cp.toString()}`)) as Record<string, unknown>;
      const items = Array.isArray(r.items) ? (r.items as Record<string, unknown>[]) : [];
      for (const it of items) {
        const id = it.id as string | undefined;
        const sn = (it.snippet ?? {}) as Record<string, unknown>;
        const thumbs = (sn.thumbnails ?? {}) as Record<string, { url?: string }>;
        const url = thumbs.default?.url ?? thumbs.medium?.url ?? null;
        if (id && url) map.set(String(id), url);
      }
    } catch (e) {
      this.logger.warn(`유튜브 채널 이미지 조회 실패: ${(e as Error).message}`);
    }
    return map;
  }

  /** videos.list 항목 → 표준 DTO */
  private fromVideo(v: Record<string, unknown>): YoutubeLive | null {
    const id = v?.id as string | undefined;
    if (!id) return null;
    const sn = (v.snippet ?? {}) as Record<string, unknown>;
    const live = (v.liveStreamingDetails ?? {}) as Record<string, unknown>;
    const thumbs = (sn.thumbnails ?? {}) as Record<string, { url?: string }>;
    const thumb = thumbs.medium?.url ?? thumbs.high?.url ?? thumbs.default?.url ?? null;
    const cc = live.concurrentViewers;
    return {
      liveId: String(id),
      title: (sn.title as string) ?? "",
      thumbnailUrl: thumb,
      concurrentUserCount: cc != null ? Number(cc) : 0,
      channelId: (sn.channelId as string) ?? "",
      channelName: (sn.channelTitle as string) ?? "",
      channelImageUrl: null, // 채널 아바타는 별도 호출(쿼터) 필요 → 생략(프론트 폴백)
      openDate: (live.actualStartTime as string) ?? null,
      url: `https://www.youtube.com/watch?v=${id}`,
    };
  }

  /**
   * 현재 진행 중인 유튜브 '사이퍼즈' 라이브 목록(캐시 우선).
   * @param limit — 최대 라이브 수(1~20, 기본 12)
   */
  async getCyphersLives(limit = 12): Promise<YoutubeLivesResult> {
    const size = Math.min(Math.max(Math.trunc(limit) || 12, 1), 20);
    const cached = await this.cache.get<YoutubeLivesResult>(CACHE_KEY);
    if (cached) return { ...cached, lives: cached.lives.slice(0, size) };

    const key = this.key();
    const debug: Record<string, unknown> = { keyPresent: !!key };
    let lives: YoutubeLive[] = [];

    if (key) {
      try {
        // 1) 라이브 검색 → videoId 목록
        const sp = new URLSearchParams({
          part: "snippet",
          type: "video",
          eventType: "live",
          q: QUERY,
          order: "viewCount",
          maxResults: "20",
          regionCode: "KR",
          relevanceLanguage: "ko",
          key,
        });
        const search = await this.getJson(`${SEARCH_URL}?${sp.toString()}`);
        const items = Array.isArray(search.items) ? (search.items as Record<string, unknown>[]) : [];
        const ids = items
          .map((it) => (it.id as Record<string, unknown>)?.videoId)
          .filter((v): v is string => typeof v === "string");
        debug.searchCount = ids.length;

        if (ids.length) {
          // 2) 상세(동시 시청자수 등)
          const vp = new URLSearchParams({
            part: "snippet,liveStreamingDetails",
            id: ids.join(","),
            key,
          });
          const vids = await this.getJson(`${VIDEOS_URL}?${vp.toString()}`);
          const vitems = Array.isArray(vids.items) ? (vids.items as Record<string, unknown>[]) : [];
          lives = vitems
            .filter((v) => {
              const live = (v.liveStreamingDetails ?? {}) as Record<string, unknown>;
              return live && !live.actualEndTime; // 아직 진행 중
            })
            .map((v) => this.fromVideo(v))
            .filter((x): x is YoutubeLive => x !== null)
            .filter((x) => this.isCyphers(x.title, x.channelName)); // 사이퍼즈 방송만
          debug.videoCount = vitems.length;
          debug.afterFilter = lives.length;
        }
      } catch (e) {
        debug.error = (e as Error).message;
        this.logger.warn(`유튜브 라이브 조회 실패: ${(e as Error).message}`);
      }
    }

    lives.sort((a, b) => b.concurrentUserCount - a.concurrentUserCount);
    if (key && lives.length) {
      const imgs = await this.channelImages(
        lives.map((l) => l.channelId),
        key,
      );
      for (const l of lives) l.channelImageUrl = imgs.get(l.channelId) ?? l.channelImageUrl;
    }
    const result: YoutubeLivesResult = { lives, fetchedAt: new Date().toISOString(), debug };
    // 키가 없으면(설정 문제) 캐시하지 않는다 — 키 넣고 재기동하면 즉시 반영되도록.
    if (key) await this.cache.set(CACHE_KEY, result, lives.length > 0 ? this.ttl() : EMPTY_TTL);
    return { ...result, lives: lives.slice(0, size) };
  }

  /** videos.list 항목 → VOD DTO */
  private fromVod(v: Record<string, unknown>): YoutubeVideo | null {
    const id = v?.id as string | undefined;
    if (!id) return null;
    const sn = (v.snippet ?? {}) as Record<string, unknown>;
    const st = (v.statistics ?? {}) as Record<string, unknown>;
    const cd = (v.contentDetails ?? {}) as Record<string, unknown>;
    const thumbs = (sn.thumbnails ?? {}) as Record<string, { url?: string }>;
    return {
      videoId: String(id),
      title: (sn.title as string) ?? "",
      thumbnailUrl: thumbs.medium?.url ?? thumbs.high?.url ?? thumbs.default?.url ?? null,
      viewCount: Number(st.viewCount ?? 0),
      publishedAt: (sn.publishedAt as string) ?? null,
      durationSec: parseISODuration(cd.duration),
      channelId: (sn.channelId as string) ?? "",
      channelName: (sn.channelTitle as string) ?? "",
      channelImageUrl: null,
      url: `https://www.youtube.com/watch?v=${id}`,
    };
  }

  /**
   * 사이퍼즈 관련 유튜브 동영상(VOD) 목록. sort: 'view'(조회순) | 'recent'(최신순). 30분 캐시.
   */
  async getCyphersVideos(
    sort: "view" | "recent" = "view",
    limit = 24,
    pageToken = "",
  ): Promise<{ videos: YoutubeVideo[]; fetchedAt: string; nextPageToken: string | null }> {
    const size = Math.min(Math.max(Math.trunc(limit) || 24, 1), 50);
    const cacheKey = `youtube:cyphers-videos:${sort}:${pageToken || "0"}:${size}`;
    const cached = await this.cache.get<{
      videos: YoutubeVideo[];
      fetchedAt: string;
      nextPageToken: string | null;
    }>(cacheKey);
    if (cached) return cached;

    const apiKey = this.key();
    let videos: YoutubeVideo[] = [];
    let nextPageToken: string | null = null;
    if (apiKey) {
      try {
        const sp = new URLSearchParams({
          part: "snippet",
          type: "video",
          q: QUERY,
          order: sort === "recent" ? "date" : "viewCount",
          maxResults: String(size),
          regionCode: "KR",
          relevanceLanguage: "ko",
          key: apiKey,
        });
        if (pageToken) sp.set("pageToken", pageToken);
        const search = await this.getJson(`${SEARCH_URL}?${sp.toString()}`);
        nextPageToken = typeof search.nextPageToken === "string" ? search.nextPageToken : null;
        const items = Array.isArray(search.items) ? (search.items as Record<string, unknown>[]) : [];
        // 현재 라이브/예정 제외(VOD만)
        const ids = items
          .filter((it) => ((it.snippet ?? {}) as Record<string, unknown>).liveBroadcastContent === "none")
          .map((it) => (it.id as Record<string, unknown>)?.videoId)
          .filter((v): v is string => typeof v === "string");
        if (ids.length) {
          const vp = new URLSearchParams({
            part: "snippet,statistics,contentDetails",
            id: ids.join(","),
            key: apiKey,
          });
          const vids = await this.getJson(`${VIDEOS_URL}?${vp.toString()}`);
          const vitems = Array.isArray(vids.items) ? (vids.items as Record<string, unknown>[]) : [];
          videos = vitems
            .map((v) => this.fromVod(v))
            .filter((x): x is YoutubeVideo => x !== null)
            .filter((x) => this.isCyphers(x.title, x.channelName));
        }
      } catch (e) {
        this.logger.warn(`유튜브 동영상 조회 실패: ${(e as Error).message}`);
      }
    }

    videos.sort((a, b) =>
      sort === "recent"
        ? (Date.parse(b.publishedAt ?? "") || 0) - (Date.parse(a.publishedAt ?? "") || 0)
        : b.viewCount - a.viewCount,
    );
    if (apiKey && videos.length) {
      const imgs = await this.channelImages(
        videos.map((v) => v.channelId),
        apiKey,
      );
      for (const v of videos) v.channelImageUrl = imgs.get(v.channelId) ?? null;
    }
    const result = { videos, fetchedAt: new Date().toISOString(), nextPageToken };
    if (apiKey) await this.cache.set(cacheKey, result, videos.length > 0 ? VIDEOS_TTL : EMPTY_TTL);
    return result;
  }
}
