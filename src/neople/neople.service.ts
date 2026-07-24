/**
 * neople.service.ts
 *
 * Neople 오픈 API(https://api.neople.co.kr/cy) 호출을 캐싱과 함께 중계하는 서비스.
 * 경로 성격에 따라 캐시 TTL을 다르게 적용하고, apikey 주입·에러 매핑을 담당한다.
 */
import { HttpException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CacheService } from "./cache.service";

const BASE = "https://api.neople.co.kr/cy";

/**
 * 경로별 캐시 TTL(초) — 데이터 성격에 맞춤
 *
 * 요청 하위 경로 패턴에 따라 캐시 유효 기간(초)을 결정한다.
 * @param path — 쿼리스트링을 제외한 하위 경로(예: "/players/123")
 * @returns 해당 경로에 적용할 캐시 TTL(초). 매칭되는 규칙이 없으면 60초.
 */
function ttlForPath(path: string): number {
  if (path.startsWith("/characters")) return 60 * 60 * 24; // 캐릭터 목록 24h
  if (/^\/battleitems\/[^/]+$/.test(path)) return 60 * 60 * 6; // 아이템 상세 6h
  if (path.startsWith("/battleitems")) return 60 * 10; // 아이템 검색 10m
  if (/^\/players\/[^/]+\/matches/.test(path)) return 60; // 매치 목록 1m
  if (/^\/players\/[^/]+$/.test(path)) return 60 * 5; // 플레이어 상세 5m
  if (path.startsWith("/players")) return 60; // 검색 1m
  if (path.startsWith("/matches/")) return 60 * 30; // 매치 상세 30m
  if (path.startsWith("/ranking")) return 60; // 랭킹 1m
  return 60;
}

/**
 * Neople API 프록시 서비스.
 * 캐시를 먼저 조회하고, 미스 시 실제 API를 호출한 뒤 결과를 캐싱한다.
 */
@Injectable()
export class NeopleService {
  /**
   * @param config — 환경변수(NEOPLE_API_KEY 등) 접근용 ConfigService(의존성 주입)
   * @param cache — API 응답 캐싱을 담당하는 CacheService(의존성 주입)
   */
  constructor(
    private readonly config: ConfigService,
    private readonly cache: CacheService,
  ) {}

  /**
   * 환경변수에서 Neople API 키를 읽어 반환한다.
   * 미설정이거나 플레이스홀더("여기에" 포함)이면 HttpException(500)을 던진다.
   *
   * @returns 유효한 Neople API 키 문자열
   */
  private apiKey(): string {
    const k = this.config.get<string>("NEOPLE_API_KEY");
    if (!k || k.includes("여기에")) {
      throw new HttpException(
        { error: { code: "NO_API_KEY", message: "NEOPLE_API_KEY가 설정되지 않았습니다." } },
        500,
      );
    }
    return k;
  }

  /**
   * subPath 예: "/players?nickname=%ED..." (apikey 제외). 캐시 → 미스 시 Neople 호출 → 캐싱
   *
   * 캐시에 값이 있으면 즉시 반환하고, 없으면 apikey 를 붙여 Neople API 를 호출한 뒤
   * 성공 응답을 경로별 TTL(ttlForPath)로 캐싱한다.
   * 연결/파싱/업스트림 오류는 각각 HttpException(503/502/원본 상태)으로 변환한다.
   *
   * @param subPath — /api/cy 접두사를 제거한 하위 경로(쿼리스트링 포함, apikey 제외)
   * @returns Neople API 응답 본문(JSON). 캐시 히트 시 캐시된 값.
   */
  async proxy(subPath: string): Promise<unknown> {
    const cacheKey = subPath;
    const cached = await this.cache.get(cacheKey);
    if (cached !== null) return cached;

    const sep = subPath.includes("?") ? "&" : "?";
    const url = `${BASE}${subPath}${sep}apikey=${encodeURIComponent(this.apiKey())}`;

    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: "application/json" } });
    } catch (e) {
      throw new HttpException(
        { error: { code: "UPSTREAM_UNREACHABLE", message: "Neople API 연결 실패", detail: (e as Error).message } },
        503,
      );
    }

    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new HttpException({ error: { code: "PARSE_ERROR", message: "응답 파싱 실패" } }, 502);
    }

    if (!res.ok) {
      throw new HttpException(body as Record<string, unknown>, res.status);
    }

    await this.cache.set(cacheKey, body, ttlForPath(subPath.split("?")[0]));
    return body;
  }
}
