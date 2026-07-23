import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/** 커뮤니티 게시글 */
@Entity("posts")
export class Post {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** free / guide / humor / video 등 */
  @Index()
  @Column({ default: "free" })
  boardType: string;

  @Column()
  title: string;

  @Column({ type: "text" })
  content: string;

  @Column({ type: "uuid", nullable: true })
  authorId: string | null;

  @Column({ type: "int", default: 0 })
  views: number;

  @Column({ type: "int", default: 0 })
  likes: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt: Date;
}
