import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/** 검색 기록 (로그인 시 userId 연결, 비로그인은 null) */
@Entity("search_history")
export class SearchHistory {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column({ type: "uuid", nullable: true })
  userId: string | null;

  @Column()
  nickname: string;

  @Column({ type: "varchar", nullable: true })
  playerId: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  searchedAt: Date;
}
