import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/** 매치 내 플레이어별 기록 (픽률·승률·아이템 채택률 집계의 원천) */
@Entity("match_players")
@Index(["matchId"])
@Index(["characterId"])
@Index(["playerId"])
export class MatchPlayer {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  matchId: string;

  @Column()
  playerId: string;

  @Column({ type: "varchar", nullable: true })
  nickname: string | null;

  @Column()
  characterId: string;

  @Column({ type: "varchar", nullable: true })
  characterName: string | null;

  /** win / lose */
  @Column()
  result: string;

  @Column({ type: "varchar", nullable: true })
  gameTypeId: string | null;

  @Column({ type: "int", default: 0 })
  killCount: number;

  @Column({ type: "int", default: 0 })
  deathCount: number;

  @Column({ type: "int", default: 0 })
  assistCount: number;

  /** 최종 장착 아이템 (집계용) */
  @Column({ type: "jsonb", nullable: true })
  items: any;
}
