/**
 * chzzk.service.ts
 *
 * 치지직(CHZZK) '사이퍼즈' 카테고리의 현재 진행 중인 라이브 목록을 조회하는 서비스.
 *
 * 공식 오픈 API(/open/v1/lives)는 카테고리 필터를 지원하지 않으므로, 다음 순서의
 * 다단계 폴백으로 '사이퍼즈' 방송만 안정적으로 뽑아낸다.
 *   1) (비공식) /service/v2/categories/GAME/Cyphers/lives  — 치지직 웹이 쓰는 카테고리별 라이브(정확)
 *   2) (비공식) /service/v1/search/lives?keyword=사이퍼즈 → liveCategoryValue 로 정확 필터
 *   3) (공식)   /open/v1/lives 를 여러 페이지 훑어 liveCategoryValue 로 필터(상위권만 커버)
 * 결과는 표준 DTO 로 정규화하고 60초 캐싱한다(빈 결과는 30초).
 *
 * 시크릿(Client-Secret)은 서버에서만 사용하며 프론트로 절대 노출하지 않는다.
 */
import { HttpException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CacheService } from "../neople/cache.service";

const OPEN_BASE = "https://openapi.chzzk.naver.com/open/v1"; // 공식 오픈 API
const SVC_BASE = "https://api.chzzk.naver.com/service"; // 비공식 서비스 API(치지직 웹이 사용) — 버전은 경로에 포함
const GAME_NAME = "사이퍼즈";
const CATEGORY_ID = "Cyphers"; // 치지직 GAME 카테고리 ID(영문명). 웹의 /category/GAME/Cyphers 와 동일.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 8000;

const LIVES_CACHE_KEY = "chzzk:cyphers-lives";
const LIVES_TTL = 60; // 라이브 목록 캐시(초)
const EMPTY_TTL = 30; // 빈 결과 캐시(초) — 방송 시작을 빠르게 반영
const LIVEURL_TTL = 20; // 라이브 재생주소(HLS) 캐시(초) — 호버 미리보기용
const VIDEOS_TTL = 900; // 사이퍼즈 VOD 목록 캐시(초)

/** 프론트엔드가 소비하는 표준 라이브 DTO(소스 API 차이를 흡수) */
export interface ChzzkLive {
  liveId: number | string;
  title: string;
  thumbnailUrl: string | null;
  concurrentUserCount: number;
  channelId: string;
  channelName: string;
  channelImageUrl: string | null;
  verified: boolean;
  categoryValue: string | null;
  openDate: string | null;
  /** 브라우저에서 방송을 여는 URL */
  url: string;
}

/** getCyphersLives 반환 형태 */
export interface ChzzkLivesResult {
  lives: ChzzkLive[];
  category: string | null;
  fetchedAt: string;
}

/** 치지직 사이퍼즈 동영상(VOD) DTO */
export interface ChzzkVideo {
  videoNo: number | string;
  title: string;
  thumbnailUrl: string | null;
  viewCount: number;
  publishedAt: string | null;
  durationSec: number | null;
  channelId: string;
  channelName: string;
  channelImageUrl: string | null;
  verified: boolean;
  url: string;
}

/** 응답 래퍼에서 data 배열/next 커서를 안전하게 추출(공식·비공식 모두 지원) */
function pick(r: unknown): { data: Record<string, unknown>[]; next?: unknown } {
  const root = (r ?? {}) as Record<string, unknown>;
  const c = (root.content ?? root) as Record<string, unknown>;
  const data = Array.isArray(c.data) ? (c.data as Record<string, unknown>[]) : [];
  const page = (c.page ?? {}) as Record<string, unknown>;
  return { data, next: page.next };
}

/**
 * 치지직 라이브 조회·정규화·캐싱 서비스.
 */
@Injectable()
export class ChzzkService {
  private readonly logger = new Logger(ChzzkService.name);

  /**
   * @param config — 환경변수(CHZZK_CLIENT_ID/SECRET) 접근용 ConfigService
   * @param cache — api_cache 테이블 기반 TTL 캐시(NeopleModule 에서 재사용)
   */
  constructor(
    private readonly config: ConfigService,
    private readonly cache: CacheService,
  ) {}

  /**
   * 치지직 오픈 API Client 자격증명을 환경변수에서 읽어 반환한다.
   * 미설정/플레이스홀더면 HttpException(500).
   */
  private creds(): { id: string; secret: string } {
    const id = this.config.get<string>("CHZZK_CLIENT_ID");
    const secret = this.config.get<string>("CHZZK_CLIENT_SECRET");
    if (!id || !secret || id.includes("여기에") || secret.includes("여기에")) {
      throw new HttpException(
        { error: { code: "NO_CHZZK_CREDENTIALS", message: "CHZZK_CLIENT_ID/SECRET가 설정되지 않았습니다." } },
        500,
      );
    }
    return { id, secret };
  }

  /** 공통 fetch(타임아웃 + JSON 파싱). !ok 또는 비 JSON 이면 예외. */
  private async fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (e) {
      throw new HttpException(
        { error: { code: "UPSTREAM_UNREACHABLE", message: "치지직 API 연결 실패", detail: (e as Error).message } },
        503,
      );
    }
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new HttpException({ error: { code: "PARSE_ERROR", message: "치지직 응답 파싱 실패" } }, 502);
    }
    if (!res.ok) {
      throw new HttpException(body as Record<string, unknown>, res.status);
    }
    return body;
  }

  /** 공식 오픈 API GET (Client 인증 헤더) */
  private openGet(path: string): Promise<unknown> {
    const { id, secret } = this.creds();
    return this.fetchJson(`${OPEN_BASE}${path}`, {
      "Client-Id": id,
      "Client-Secret": secret,
      "Content-Type": "application/json",
    });
  }

  /** 비공식 서비스 API GET (브라우저 UA 필요) */
  private svcGet(path: string): Promise<unknown> {
    return this.fetchJson(`${SVC_BASE}${path}`, { "User-Agent": UA, Accept: "application/json" });
  }

  /** liveCategoryValue 가 '사이퍼즈' 카테고리인지 판정(값 표기 차이에 관대) */
  private isCyphers(v: unknown, categoryValue: string): boolean {
    const s = String(v ?? "");
    return s === categoryValue || s.includes(GAME_NAME);
  }

  /** '{type}' 플레이스홀더가 있는 썸네일 URL 을 실제 해상도로 치환 */
  private thumb(url: unknown): string | null {
    if (typeof url !== "string" || !url) return null;
    return url.replace("{type}", "480");
  }

  /** 비공식 서비스 API 라이브 객체 → 표준 DTO */
  private fromSvc(x: Record<string, unknown>): ChzzkLive | null {
    const ch = (x.channel ?? {}) as Record<string, unknown>;
    const channelId = (ch.channelId ?? x.channelId) as string | undefined;
    if (!channelId) return null;
    return {
      liveId: (x.liveId as number | string) ?? channelId,
      title: (x.liveTitle as string) ?? "",
      thumbnailUrl: this.thumb(x.liveImageUrl) ?? this.thumb(ch.channelImageUrl),
      concurrentUserCount: Number(x.concurrentUserCount ?? 0),
      channelId: String(channelId),
      channelName: (ch.channelName as string) ?? "",
      channelImageUrl: (ch.channelImageUrl as string) ?? null,
      verified: Boolean(ch.verifiedMark),
      categoryValue: (x.liveCategoryValue as string) ?? null,
      openDate: (x.openDate as string) ?? null,
      url: `https://chzzk.naver.com/live/${channelId}`,
    };
  }

  /** 공식 오픈 API 라이브 객체 → 표준 DTO */
  private fromOpen(x: Record<string, unknown>): ChzzkLive | null {
    const channelId = x.channelId as string | undefined;
    if (!channelId) return null;
    return {
      liveId: (x.liveId as number | string) ?? channelId,
      title: (x.liveTitle as string) ?? "",
      thumbnailUrl: this.thumb(x.liveThumbnailImageUrl) ?? this.thumb(x.channelImageUrl),
      concurrentUserCount: Number(x.concurrentUserCount ?? 0),
      channelId: String(channelId),
      channelName: (x.channelName as string) ?? "",
      channelImageUrl: (x.channelImageUrl as string) ?? null,
      verified: false,
      categoryValue: (x.liveCategoryValue as string) ?? null,
      openDate: (x.openDate as string) ?? null,
      url: `https://chzzk.naver.com/live/${channelId}`,
    };
  }

  /** [1] 비공식 카테고리별 라이브(치지직 웹이 쓰는 v2 엔드포인트) */
  private async viaCategory(size: number): Promise<ChzzkLive[]> {
    const r = await this.svcGet(
      `/v2/categories/GAME/${encodeURIComponent(CATEGORY_ID)}/lives?size=${size}&sortType=POPULAR`,
    );
    return pick(r)
      .data.map((x) => this.fromSvc(x))
      .filter((x): x is ChzzkLive => x !== null);
  }

  /** [2] 비공식 라이브 검색 후 liveCategoryValue 로 정확 필터 */
  private async viaSearch(size: number): Promise<ChzzkLive[]> {
    const r = await this.svcGet(`/v1/search/lives?keyword=${encodeURIComponent(GAME_NAME)}&size=${size}`);
    return pick(r)
      .data.filter((x) => this.isCyphers(x.liveCategoryValue, GAME_NAME))
      .map((x) => this.fromSvc(x))
      .filter((x): x is ChzzkLive => x !== null);
  }

  /** [3] 공식 오픈 API 인기 라이브를 여러 페이지 훑어 사이퍼즈만 필터(폴백, 상위권만 커버) */
  private async viaOpenFilter(want: number, maxPages = 8): Promise<ChzzkLive[]> {
    const out: ChzzkLive[] = [];
    let next: string | undefined;
    for (let i = 0; i < maxPages; i++) {
      const qs = `?size=20${next ? `&next=${encodeURIComponent(next)}` : ""}`;
      const r = await this.openGet(`/lives${qs}`);
      const { data, next: n } = pick(r);
      for (const x of data) {
        if (this.isCyphers(x.liveCategoryValue, GAME_NAME)) {
          const dto = this.fromOpen(x);
          if (dto) out.push(dto);
        }
      }
      if (out.length >= want || data.length === 0) break;
      next = typeof n === "string" ? n : undefined;
      if (!next) break;
    }
    return out;
  }

  /**
   * 현재 진행 중인 '사이퍼즈' 라이브 목록을 반환한다(캐시 우선, 다단계 폴백).
   *
   * @param limit — 반환할 최대 라이브 수(1~20, 기본 8)
   * @returns 정규화·정렬·중복제거된 라이브 목록 + 카테고리명 + 조회 시각
   */
  async getCyphersLives(limit = 8): Promise<ChzzkLivesResult> {
    const size = Math.min(Math.max(Math.trunc(limit) || 8, 1), 20);
    const cached = await this.cache.get<ChzzkLivesResult>(LIVES_CACHE_KEY);
    if (cached) return { ...cached, lives: cached.lives.slice(0, size) };

    let lives: ChzzkLive[] = [];
    const attempts: Array<[string, () => Promise<ChzzkLive[]>]> = [
      ["카테고리", () => this.viaCategory(20)],
      ["검색", () => this.viaSearch(20)],
      ["공식폴백", () => this.viaOpenFilter(size)],
    ];

    for (const [name, run] of attempts) {
      try {
        const r = await run();
        if (r.length > 0) {
          lives = r;
          break;
        }
      } catch (e) {
        this.logger.warn(`치지직 라이브 조회(${name}) 실패: ${(e as Error).message}`);
      }
    }

    // 채널 기준 중복 제거 → 시청자수 내림차순
    const seen = new Set<string>();
    lives = lives
      .filter((l) => (seen.has(l.channelId) ? false : (seen.add(l.channelId), true)))
      .sort((a, b) => b.concurrentUserCount - a.concurrentUserCount);

    const result: ChzzkLivesResult = {
      lives,
      category: GAME_NAME,
      fetchedAt: new Date().toISOString(),
    };
    await this.cache.set(LIVES_CACHE_KEY, result, lives.length > 0 ? LIVES_TTL : EMPTY_TTL);
    return { ...result, lives: lives.slice(0, size) };
  }

  /**
   * 특정 채널의 현재 라이브 HLS 재생 주소(m3u8)를 반환한다(호버 미리보기용, 20s 캐시).
   * 비공식 live-detail 의 livePlaybackJson 을 파싱해 LLHLS(저지연)>HLS 순으로 고른다.
   * 실패 시 url=null (프론트는 썸네일로 폴백).
   *
   * @param channelId — 치지직 채널 ID
   */
  async getLiveUrl(
    channelId: string,
  ): Promise<{ channelId: string; url: string | null; debug?: Record<string, unknown> }> {
    let id = String(channelId ?? "").trim();
    // 진단 편의: channelId 미지정 시 현재 최상위 라이브 채널로 대체
    if (!id) {
      try {
        const top = await this.getCyphersLives(1);
        id = top.lives[0]?.channelId ?? "";
      } catch {
        /* noop */
      }
    }
    if (!id) return { channelId: id, url: null, debug: { note: "현재 라이브 채널을 찾지 못함" } };

    const key = `chzzk:liveurl:${id}`;
    const cached = await this.cache.get<{
      channelId: string;
      url: string | null;
      debug?: Record<string, unknown>;
    }>(key);
    if (cached) return cached;

    let url: string | null = null;
    const debug: Record<string, unknown> = { channelId: id };
    try {
      const r = (await this.svcGet(`/v2/channels/${encodeURIComponent(id)}/live-detail`)) as Record<
        string,
        unknown
      >;
      const content = (r?.content ?? {}) as Record<string, unknown>;
      debug.contentKeys = Object.keys(content).slice(0, 25);
      const raw = content.livePlaybackJson;
      debug.hasPlaybackJson = raw != null;
      const pb = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown> | null;
      const media = Array.isArray(pb?.media) ? (pb!.media as Record<string, unknown>[]) : [];
      const proto = (m: Record<string, unknown>) => String(m?.protocol ?? "").toUpperCase();
      debug.mediaCount = media.length;
      debug.protocols = media.map(proto);
      const picked =
        media.find((m) => proto(m) === "HLS") ?? media.find((m) => proto(m) === "LLHLS") ?? media[0];
      url = typeof picked?.path === "string" ? (picked.path as string) : null;
    } catch (e) {
      debug.error = (e as Error).message;
      this.logger.warn(`치지직 라이브 재생주소 조회 실패(${id}): ${(e as Error).message}`);
    }
    const result = { channelId: id, url, debug };
    await this.cache.set(key, result, LIVEURL_TTL);
    return result;
  }

  /** 비공식 search/videos 항목 → VOD DTO */
  private fromVod(x: Record<string, unknown>): ChzzkVideo | null {
    const videoNo = x.videoNo as number | string | undefined;
    if (videoNo == null) return null;
    const ch = (x.channel ?? {}) as Record<string, unknown>;
    const pubMs =
      typeof x.publishDateAt === "number"
        ? x.publishDateAt
        : Date.parse(String(x.publishDate ?? "").replace(" ", "T") + "+09:00");
    return {
      videoNo,
      title: (x.videoTitle as string) ?? "",
      thumbnailUrl: this.thumb(x.thumbnailImageUrl),
      viewCount: Number(x.readCount ?? 0),
      publishedAt: Number.isFinite(pubMs) ? new Date(pubMs).toISOString() : null,
      durationSec: Number(x.duration) || null,
      channelId: String((ch.channelId as string) ?? ""),
      channelName: (ch.channelName as string) ?? "",
      channelImageUrl: (ch.channelImageUrl as string) ?? null,
      verified: Boolean(ch.verifiedMark),
      url: `https://chzzk.naver.com/video/${videoNo}`,
    };
  }

  /**
   * 사이퍼즈 관련 치지직 동영상(VOD) 목록. sort: 'view'(조회순) | 'recent'(최신순).
   * 비공식 search/videos 는 sortType 을 안 받으므로 받아온 배치를 서버에서 정렬한다.
   */
  async getCyphersVideos(
    sort: "view" | "recent" = "view",
    limit = 24,
    offset = 0,
  ): Promise<{ videos: ChzzkVideo[]; fetchedAt: string }> {
    const size = Math.min(Math.max(Math.trunc(limit) || 24, 1), 40);
    const off = Math.max(Math.trunc(offset) || 0, 0);
    const cacheKey = `chzzk:cyphers-videos:${sort}:${off}:${size}`;
    const cached = await this.cache.get<{ videos: ChzzkVideo[]; fetchedAt: string }>(cacheKey);
    if (cached) return cached;

    let videos: ChzzkVideo[] = [];
    try {
      const r = await this.svcGet(
        `/v1/search/videos?keyword=${encodeURIComponent(GAME_NAME)}&offset=${off}&size=${size}`,
      );
      videos = pick(r)
        .data.filter(
          (x) =>
            String(x.videoCategoryValue ?? "").includes(GAME_NAME) ||
            String(x.videoTitle ?? "").includes(GAME_NAME),
        )
        .map((x) => this.fromVod(x))
        .filter((x): x is ChzzkVideo => x !== null);
    } catch (e) {
      this.logger.warn(`치지직 동영상 조회 실패: ${(e as Error).message}`);
    }

    // 페이지 내 중복제거 + 정렬(조회/최신)
    const seen = new Set<string>();
    videos = videos
      .filter((v) => (seen.has(String(v.videoNo)) ? false : (seen.add(String(v.videoNo)), true)))
      .sort((a, b) =>
        sort === "recent"
          ? (Date.parse(b.publishedAt ?? "") || 0) - (Date.parse(a.publishedAt ?? "") || 0)
          : b.viewCount - a.viewCount,
      );
    const result = { videos, fetchedAt: new Date().toISOString() };
    await this.cache.set(cacheKey, result, VIDEOS_TTL);
    return result;
  }
}
