/**
 * api_cache 테이블 엔티티 — Neople 오픈 API 응답을 TTL(만료시각) 기반으로 캐싱한다.
 * 동일 요청 반복 시 외부 API 호출/지연을 줄이기 위한 저장소.
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";

/** Neople API 응답 캐시 (TTL 기반) */
@Entity("api_cache", { comment: "Neople 오픈 API 응답 캐시 (TTL 기반)" })
export class ApiCache {
  /** 캐시 키 — 요청 경로+쿼리 기반 (예: "cy/players/{id}"). 기본키. */
  @PrimaryColumn({ comment: "캐시 키(요청 경로/쿼리 기반, 예: cy/players/{id})" })
  cacheKey: string;

  /** 캐싱된 API 응답 본문 (원본 JSON 그대로) */
  @Column({ type: "jsonb", comment: "캐싱된 API 응답(JSON)" })
  payload: unknown;

  /** 만료 시각 — 이 시각을 지나면 캐시 무효로 보고 재조회 */
  @Index()
  @Column({ type: "timestamptz", comment: "캐시 만료 시각(이후 무효)" })
  expiresAt: Date;

  /** 캐시 최초 저장 시각 */
  @CreateDateColumn({ type: "timestamptz", comment: "캐시 저장 시각" })
  createdAt: Date;
}
