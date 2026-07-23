import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/** 게시글 댓글 */
@Entity("comments")
export class Comment {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column("uuid")
  postId: string;

  @Column({ type: "uuid", nullable: true })
  authorId: string | null;

  @Column({ type: "text" })
  content: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}
