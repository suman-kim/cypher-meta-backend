/**
 * cache.service.ts
 *
 * api_cache 테이블을 이용한 TTL 기반 영속 캐시 서비스.
 * Neople API 응답 등 외부 호출 결과를 키/만료시각과 함께 저장·조회한다.
 */
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ApiCache } from "../database/entities";

/** api_cache 테이블 기반 TTL 캐시 */
@Injectable()
export class CacheService {
  /**
   * @param repo — 캐시 레코드(ApiCache) 리포지토리(의존성 주입)
   */
  constructor(
    @InjectRepository(ApiCache) private readonly repo: Repository<ApiCache>,
  ) {}

  /**
   * 캐시에서 키에 해당하는 값을 조회한다. 만료된 항목은 삭제하고 null 을 반환한다.
   *
   * @param key — 조회할 캐시 키
   * @returns 유효한 캐시 payload(제네릭 T). 항목이 없거나 만료된 경우 null.
   */
  async get<T = unknown>(key: string): Promise<T | null> {
    const row = await this.repo.findOne({ where: { cacheKey: key } });
    if (!row) return null;
    if (row.expiresAt.getTime() < Date.now()) {
      await this.repo.delete({ cacheKey: key });
      return null;
    }
    return row.payload as T;
  }

  /**
   * 값을 캐시에 저장한다. 만료시각은 현재시각 + ttlSeconds 로 계산한다.
   *
   * @param key — 저장할 캐시 키
   * @param payload — 저장할 값(JSON 직렬화 가능한 임의 데이터)
   * @param ttlSeconds — 유효 기간(초)
   * @returns 없음(저장 완료 시 resolve)
   */
  async set(key: string, payload: unknown, ttlSeconds: number): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    // 주의: 같은 캐시 키에 대한 동시 요청이 둘 다 캐시 미스로 INSERT 를 시도하면
    // PK(cacheKey) 중복이 난다(save 는 존재 확인→INSERT 사이 경쟁에 취약).
    // upsert(INSERT ... ON CONFLICT (cacheKey) DO UPDATE)로 동시성·재삽입을 안전하게 처리하고,
    // 기존 행이 있으면 payload·만료시각을 갱신한다.
    // payload 는 엔티티에서 unknown(jsonb) 이라 upsert 의 엄격한 타입에 맞춰 캐스팅한다.
    await this.repo.upsert(
      { cacheKey: key, payload: payload as object, expiresAt },
      ["cacheKey"],
    );
  }
}
