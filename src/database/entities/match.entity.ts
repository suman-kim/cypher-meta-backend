import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";

/** 수집한 매치 (메타 집계용) */
@Entity("matches")
export class Match {
  @PrimaryColumn()
  matchId: string;

  @Index()
  @Column()
  gameTypeId: string;

  @Column({ type: "varchar", nullable: true })
  mapId: string | null;

  @Column({ type: "varchar", nullable: true })
  mapName: string | null;

  @Index()
  @Column({ type: "timestamptz", nullable: true })
  playedAt: Date | null;

  /** 원본 응답 보존(선택) */
  @Column({ type: "jsonb", nullable: true })
  raw: unknown;

  @CreateDateColumn({ type: "timestamptz" })
  collectedAt: Date;
}
