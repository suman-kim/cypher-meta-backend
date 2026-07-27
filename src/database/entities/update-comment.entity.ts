/**
 * update_comments 테이블 엔티티 — 업데이트 노트(update_notes)에 달린 댓글.
 * 비회원 작성(닉네임 + 비밀번호 해시)으로 삭제 권한을 검증한다. (커뮤니티 댓글과 동일 방식)
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/** 업데이트 노트 댓글 */
@Entity("update_comments", { comment: "업데이트 노트 댓글" })
export class UpdateComment {
  /** 댓글 고유 ID (UUID 자동 생성, 기본키) */
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** 소속 업데이트 노트 ID (update_notes.id 참조) */
  @Index()
  @Column("uuid", { comment: "소속 업데이트 노트 ID(update_notes.id)" })
  updateId: string;

  /** 부모 댓글 ID (대댓글용). 최상위 댓글은 null */
  @Index()
  @Column({ type: "uuid", nullable: true, comment: "부모 댓글 ID(대댓글, 최상위는 null)" })
  parentId: string | null;

  /** 작성자 표시명 (비회원=입력 닉네임) */
  @Column({ type: "varchar", nullable: true, comment: "작성자 표시명(비회원 닉네임)" })
  authorName: string | null;

  /** 비회원 비밀번호 해시 (삭제 확인용). select:false 라 기본 조회에서 제외됨 */
  @Column({
    type: "varchar",
    nullable: true,
    select: false,
    comment: "비회원 비밀번호 해시(삭제 확인용)",
  })
  guestPassword: string | null;

  /** 댓글 본문 */
  @Column({ type: "text", comment: "댓글 본문" })
  content: string;

  /** 작성 시각 */
  @CreateDateColumn({ type: "timestamptz", comment: "작성 시각" })
  createdAt: Date;
}
