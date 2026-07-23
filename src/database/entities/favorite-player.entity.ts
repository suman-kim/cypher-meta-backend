import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from "typeorm";

/** 즐겨찾기 플레이어 */
@Entity("favorite_players")
@Unique(["userId", "playerId"])
export class FavoritePlayer {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column("uuid")
  userId: string;

  @Column()
  playerId: string;

  @Column()
  nickname: string;

  @Column({ type: "varchar", nullable: true })
  memo: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}
