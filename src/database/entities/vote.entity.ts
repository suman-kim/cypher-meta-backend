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
@Entity("votes")
@Unique(["visitorId", "kind"])
export class Vote {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column()
  visitorId: string;

  /** "tier" | "comp" */
  @Column()
  kind: string;

  /** tier: { tank, melee, ranged, support } (characterId) · comp: { formationKey, ids: string[] } */
  @Column({ type: "jsonb" })
  payload: any;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt: Date;
}
