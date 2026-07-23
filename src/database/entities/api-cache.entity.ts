import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";

/** Neople API 응답 캐시 (TTL 기반) */
@Entity("api_cache")
export class ApiCache {
  /** 캐시 키 (예: "cy/players/{id}") */
  @PrimaryColumn()
  cacheKey: string;

  @Column({ type: "jsonb" })
  payload: unknown;

  @Index()
  @Column({ type: "timestamptz" })
  expiresAt: Date;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}
