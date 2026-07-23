import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/** 게시글 댓글 */
@Entity("comments")
export class Comment {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column("uuid")
  postId: string;

  /** 로그인 회원 작성 시 사용 (추후 로그인 기능용) */
  @Column({ type: "uuid", nullable: true })
  authorId: string | null;

  /** 작성자 표시명 (비회원=입력 닉네임) */
  @Column({ type: "varchar", nullable: true })
  authorName: string | null;

  /** 비회원 비밀번호 해시 (삭제 확인용) */
  @Column({ type: "varchar", nullable: true, select: false })
  guestPassword: string | null;

  @Column({ type: "text" })
  content: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}
