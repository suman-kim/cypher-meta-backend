/**
 * search_history 테이블 엔티티 — 플레이어 닉네임 검색 기록.
 * 로그인 시 userId 로 연결, 비로그인은 null.
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/** 검색 기록 (로그인 시 userId 연결, 비로그인은 null) */
@Entity("search_history", { comment: "플레이어 검색 기록" })
export class SearchHistory {
  /** 기록 고유 ID (UUID 자동 생성, 기본키) */
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** 검색한 회원 ID — 로그인 사용자일 때만, 비로그인은 null */
  @Index()
  @Column({ type: "uuid", nullable: true, comment: "회원 ID(비로그인 null)" })
  userId: string | null;

  /** 검색한 닉네임 */
  @Column({ comment: "검색 닉네임" })
  nickname: string;

  /** 매칭된 플레이어 ID(있을 때) */
  @Column({ type: "varchar", nullable: true, comment: "매칭된 플레이어 ID(있을 때)" })
  playerId: string | null;

  /** 검색 시각 */
  @CreateDateColumn({ type: "timestamptz", comment: "검색 시각" })
  searchedAt: Date;
}
