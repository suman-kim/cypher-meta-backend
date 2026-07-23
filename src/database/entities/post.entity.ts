import {
  Column,
  CreateDateColumn,
  Entity,
  Generated,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

/** 커뮤니티 게시글 */
@Entity("posts")
export class Post {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** 화면의 "번호" 컬럼용 자동 증가 순번(전역 시퀀스) */
  @Index()
  @Generated("increment")
  @Column({ type: "int" })
  seq: number;

  /** 게시판: free / guide / humor / video (+ 내부용 notice) */
  @Index()
  @Column({ default: "free" })
  boardType: string;

  /** 말머리(분류): free(자유) / question(질문) / info(정보) / discussion(토론) */
  @Column({ default: "free" })
  category: string;

  /** 공지 고정 여부 */
  @Index()
  @Column({ type: "boolean", default: false })
  isNotice: boolean;

  @Column()
  title: string;

  @Column({ type: "text" })
  content: string;

  /** 로그인 회원 작성 시 사용 (추후 로그인 기능용) */
  @Column({ type: "uuid", nullable: true })
  authorId: string | null;

  /** 작성자 표시명 (비회원=입력 닉네임, 회원=닉네임 스냅샷) */
  @Column({ type: "varchar", nullable: true })
  authorName: string | null;

  /** 비회원 비밀번호 해시 (수정/삭제 확인용). 회원 글은 null */
  @Column({ type: "varchar", nullable: true, select: false })
  guestPassword: string | null;

  @Column({ type: "int", default: 0 })
  views: number;

  @Column({ type: "int", default: 0 })
  likes: number;

  @Column({ type: "int", default: 0 })
  commentCount: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt: Date;
}
