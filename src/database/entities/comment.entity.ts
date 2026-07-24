/**
 * comments 테이블 엔티티 — 커뮤니티 게시글(posts)에 달린 댓글.
 * 비회원 작성(닉네임 + 비밀번호 해시)과 추후 회원 작성 모두 대응한다.
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/** 게시글 댓글 */
@Entity("comments", { comment: "게시글 댓글" })
export class Comment {
  /** 댓글 고유 ID (UUID 자동 생성, 기본키) */
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** 소속 게시글 ID (posts.id 참조) */
  @Index()
  @Column("uuid", { comment: "소속 게시글 ID(posts.id)" })
  postId: string;

  /** 작성 회원 ID — 로그인 회원 작성 시 사용(추후 로그인 기능용), 비회원은 null */
  @Column({ type: "uuid", nullable: true, comment: "작성 회원 ID(로그인용, 비회원 null)" })
  authorId: string | null;

  /** 작성자 표시명 (비회원=입력 닉네임) */
  @Column({ type: "varchar", nullable: true, comment: "작성자 표시명(비회원=입력 닉네임)" })
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
