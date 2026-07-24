/**
 * matches 테이블 엔티티 — 메타 집계를 위해 수집한 매치(경기) 단위 레코드.
 * matchId 를 기본키로 사용해 같은 경기가 중복 저장되지 않게 한다.
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";

/** 수집한 매치 (메타 집계용) */
@Entity("matches", { comment: "수집한 매치(경기) — 메타 집계용" })
export class Match {
  /** 매치 고유 ID (Neople matchId). 기본키 — 중복 수집 방지 */
  @PrimaryColumn({ comment: "매치 ID(Neople matchId), 기본키" })
  matchId: string;

  /** 게임 타입 (rating=공식전 / normal=일반전 등) */
  @Index()
  @Column({ comment: "게임 타입(rating/normal 등)" })
  gameTypeId: string;

  /** 맵 ID (있을 때) */
  @Column({ type: "varchar", nullable: true, comment: "맵 ID" })
  mapId: string | null;

  /** 맵 이름 (있을 때) */
  @Column({ type: "varchar", nullable: true, comment: "맵 이름" })
  mapName: string | null;

  /** 경기 진행 시각 */
  @Index()
  @Column({ type: "timestamptz", nullable: true, comment: "경기 진행 시각" })
  playedAt: Date | null;

  /** 원본 매치 상세 응답 보존(선택) */
  @Column({ type: "jsonb", nullable: true, comment: "원본 응답(JSON) 보존" })
  raw: unknown;

  /** 우리 DB에 수집된 시각 */
  @CreateDateColumn({ type: "timestamptz", comment: "수집 시각" })
  collectedAt: Date;
}
