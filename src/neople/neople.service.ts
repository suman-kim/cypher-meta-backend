import { HttpException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CacheService } from "./cache.service";

const BASE = "https://api.neople.co.kr/cy";

/** 경로별 캐시 TTL(초) — 데이터 성격에 맞춤 */
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

@Injectable()
export class NeopleService {
  constructor(
    private readonly config: ConfigService,
    private readonly cache: CacheService,
  ) {}

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

  /** subPath 예: "/players?nickname=%ED..." (apikey 제외). 캐시 → 미스 시 Neople 호출 → 캐싱 */
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
