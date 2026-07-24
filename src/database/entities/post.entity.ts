/**
 * posts 테이블 엔티티 — 커뮤니티 게시글.
 * 화면 "번호"용 전역 증가 순번(seq), 게시판/말머리 분류, 공지 고정, 조회/추천/댓글 수를 담는다.
 * 비회원 작성(닉네임 + 비밀번호 해시)과 추후 회원 작성 모두 대응.
 */
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
@Entity("posts", { comment: "커뮤니티 게시글" })
export class Post {
  /** 게시글 고유 ID (UUID 자동 생성, 기본키) */
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** 화면의 "번호" 컬럼용 자동 증가 순번(전역 시퀀스) */
  @Index()
  @Generated("increment")
  @Column({ type: "int", comment: "게시글 순번(화면 번호용, 전역 증가)" })
  seq: number;

  /** 게시판: free / guide / humor / video (+ 내부용 notice) */
  @Index()
  @Column({ default: "free", comment: "게시판(free/guide/humor/video, 내부 notice)" })
  boardType: string;

  /** 말머리(분류): free(자유) / question(질문) / info(정보) / discussion(토론) */
  @Column({ default: "free", comment: "말머리(free/question/info/discussion)" })
  category: string;

  /** 공지 고정 여부 */
  @Index()
  @Column({ type: "boolean", default: false, comment: "공지 고정 여부" })
  isNotice: boolean;

  /** 게시글 제목 */
  @Column({ comment: "제목" })
  title: string;

  /** 게시글 본문 */
  @Column({ type: "text", comment: "본문" })
  content: string;

  /** 로그인 회원 작성 시 사용 (추후 로그인 기능용). 비회원은 null */
  @Column({ type: "uuid", nullable: true, comment: "작성 회원 ID(로그인용, 비회원 null)" })
  authorId: string | null;

  /** 작성자 표시명 (비회원=입력 닉네임, 회원=닉네임 스냅샷) */
  @Column({ type: "varchar", nullable: true, comment: "작성자 표시명(닉네임)" })
  authorName: string | null;

  /** 비회원 비밀번호 해시 (수정/삭제 확인용). 회원 글은 null. select:false 로 기본 조회 제외 */
  @Column({
    type: "varchar",
    nullable: true,
    select: false,
    comment: "비회원 비밀번호 해시(수정/삭제 확인용)",
  })
  guestPassword: string | null;

  /** 조회 수 */
  @Column({ type: "int", default: 0, comment: "조회 수" })
  views: number;

  /** 추천 수 */
  @Column({ type: "int", default: 0, comment: "추천 수" })
  likes: number;

  /** 댓글 수(집계 캐시) */
  @Column({ type: "int", default: 0, comment: "댓글 수(집계)" })
  commentCount: number;

  /** 작성 시각 */
  @CreateDateColumn({ type: "timestamptz", comment: "작성 시각" })
  createdAt: Date;

  /** 마지막 수정 시각 */
  @UpdateDateColumn({ type: "timestamptz", comment: "마지막 수정 시각" })
  updatedAt: Date;
}
