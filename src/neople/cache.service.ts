import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ApiCache } from "../database/entities";

/** api_cache 테이블 기반 TTL 캐시 */
@Injectable()
export class CacheService {
  constructor(
    @InjectRepository(ApiCache) private readonly repo: Repository<ApiCache>,
  ) {}

  async get<T = unknown>(key: string): Promise<T | null> {
    const row = await this.repo.findOne({ where: { cacheKey: key } });
    if (!row) return null;
    if (row.expiresAt.getTime() < Date.now()) {
      await this.repo.delete({ cacheKey: key });
      return null;
    }
    return row.payload as T;
  }

  async set(key: string, payload: unknown, ttlSeconds: number): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    await this.repo.save({ cacheKey: key, payload, expiresAt });
  }
}
