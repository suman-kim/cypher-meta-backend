/**
 * update_notes 테이블 엔티티 — 사이트 업데이트 노트(패치노트).
 * 운영자가 관리자 페이지에서 작성하며, 버전 라벨/제목/본문과 발행 여부를 담는다.
 * 공개 화면은 published=true 만 노출하고, 관리자 화면은 초안(draft) 포함 전체를 본다.
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

/** 사이트 업데이트 노트(패치노트) */
@Entity("update_notes", { comment: "사이트 업데이트 노트(패치노트)" })
export class UpdateNote {
  /** 업데이트 노트 고유 ID (UUID 자동 생성, 기본키) */
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** 버전 라벨(선택). 예: "v1.4.0", "2026.07.27". 비워도 됨 */
  @Column({ type: "varchar", length: 40, nullable: true, comment: "버전 라벨(선택)" })
  version: string | null;

  /** 업데이트 제목 */
  @Column({ comment: "제목" })
  title: string;

  /** 업데이트 본문(줄바꿈 보존, 간단한 '- ' 불릿 지원) */
  @Column({ type: "text", comment: "본문" })
  content: string;

  /** 발행 여부(false=초안, 공개 화면 비노출) */
  @Index()
  @Column({ type: "boolean", default: true, comment: "발행 여부(false=초안)" })
  published: boolean;

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
