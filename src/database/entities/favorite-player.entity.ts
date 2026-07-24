/**
 * favorite_players 테이블 엔티티 — 회원이 즐겨찾기한 플레이어.
 * (userId, playerId) 조합은 유니크 — 같은 플레이어를 중복 즐겨찾기하지 못하게 한다.
 */
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from "typeorm";

/** 즐겨찾기 플레이어 */
@Entity("favorite_players", { comment: "회원 즐겨찾기 플레이어" })
@Unique(["userId", "playerId"])
export class FavoritePlayer {
  /** 즐겨찾기 고유 ID (UUID 자동 생성, 기본키) */
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** 즐겨찾기한 회원 ID (users.id) */
  @Column("uuid", { comment: "회원 ID(users.id)" })
  userId: string;

  /** 즐겨찾기 대상 플레이어의 Neople playerId */
  @Column({ comment: "플레이어 ID(Neople playerId)" })
  playerId: string;

  /** 즐겨찾기 당시 플레이어 닉네임(스냅샷) */
  @Column({ comment: "플레이어 닉네임(스냅샷)" })
  nickname: string;

  /** 사용자 메모(선택) */
  @Column({ type: "varchar", nullable: true, comment: "사용자 메모(선택)" })
  memo: string | null;

  /** 즐겨찾기 등록 시각 */
  @CreateDateColumn({ type: "timestamptz", comment: "등록 시각" })
  createdAt: Date;
}
