/**
 * tracked_players 테이블 엔티티 — 개인 히스토리를 적립할 "대상 목록"(watchlist).
 * 검색/조회된 플레이어를 여기에 등록해두고, 하루 1회 cron 이 이 목록을 돌며
 * 신규는 전체 백필, 기존은 최근분을 갱신한다. 커버리지 상태도 함께 기록한다.
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from "typeorm";

/** 개인 히스토리 적립 대상(watchlist) + 커버리지 상태 */
@Entity("tracked_players", { comment: "개인 히스토리 적립 대상(watchlist)" })
export class TrackedPlayer {
  /** 플레이어 ID (Neople playerId) — 기본키 */
  @PrimaryColumn({ comment: "플레이어 ID(Neople playerId)" })
  playerId: string;

  /** 닉네임 (등록 시점 스냅샷) */
  @Column({ type: "varchar", nullable: true, comment: "닉네임(스냅샷)" })
  nickname: string | null;

  /** 추적 유입 경로 (search=검색, ranker=랭킹, favorite=즐겨찾기) */
  @Column({ type: "varchar", nullable: true, comment: "유입 경로(search/ranker/favorite)" })
  source: string | null;

  /** 활성 여부 (false 면 갱신 대상에서 제외) */
  @Column({ type: "boolean", default: true, comment: "활성 여부" })
  active: boolean;

  /** 전체 백필(과거 시즌까지 1회 크게 긁기) 완료 여부 */
  @Column({ type: "boolean", default: false, comment: "전체 백필 완료 여부" })
  backfilled: boolean;

  /** 저장된 가장 오래된 경기 시각 (커버리지 하한) */
  @Column({ type: "timestamptz", nullable: true, comment: "저장된 가장 오래된 경기 시각" })
  oldestPlayedAt: Date | null;

  /** 저장된 가장 최신 경기 시각 (커버리지 상한) */
  @Column({ type: "timestamptz", nullable: true, comment: "저장된 가장 최신 경기 시각" })
  newestPlayedAt: Date | null;

  /** 저장된 매치 수 */
  @Column({ type: "int", default: 0, comment: "저장된 매치 수" })
  matchCount: number;

  /** 마지막 적립 갱신 시각 (cron 회전 우선순위 기준) */
  @Index()
  @Column({ type: "timestamptz", nullable: true, comment: "마지막 적립 갱신 시각" })
  lastRefreshedAt: Date | null;

  /** 추적 등록 시각 */
  @CreateDateColumn({ type: "timestamptz", comment: "추적 등록 시각" })
  createdAt: Date;

  /** 레코드 갱신 시각 */
  @UpdateDateColumn({ type: "timestamptz", comment: "레코드 갱신 시각" })
  updatedAt: Date;
}
