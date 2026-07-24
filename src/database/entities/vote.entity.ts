/**
 * votes 테이블 엔티티 — 커뮤니티 투표(캐릭터 티어 / 조합 티어).
 * 방문자(visitorId)별·종류(kind)별 1표만 유지하며, 재투표 시 payload 를 갱신한다.
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";

/** 커뮤니티 투표 (캐릭터 티어 / 조합 티어). 방문자(visitorId)별·종류(kind)별 1표(재투표=갱신). */
@Entity("votes", { comment: "커뮤니티 투표(캐릭터/조합 티어) — 방문자·종류별 1표" })
@Unique(["visitorId", "kind"])
export class Vote {
  /** 투표 고유 ID (UUID 자동 생성, 기본키) */
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** 익명 방문자 식별자 — (visitorId, kind) 조합으로 1표 보장 */
  @Index()
  @Column({ comment: "익명 방문자 식별자(kind와 함께 1표 보장)" })
  visitorId: string;

  /** "tier" | "comp" */
  @Column({ comment: "투표 종류(tier=캐릭터 티어 / comp=조합 티어)" })
  kind: string;

  /** tier: { tank, melee, ranged, support } (characterId) · comp: { formationKey, ids: string[] } */
  @Column({
    type: "jsonb",
    comment: "투표 내용(JSON): tier=역할별 캐릭터, comp=편성키+캐릭터목록",
  })
  payload: any;

  /** 최초 투표 시각 */
  @CreateDateColumn({ type: "timestamptz", comment: "최초 투표 시각" })
  createdAt: Date;

  /** 재투표(갱신) 시각 */
  @UpdateDateColumn({ type: "timestamptz", comment: "마지막 갱신 시각" })
  updatedAt: Date;
}
