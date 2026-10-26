/**
 * banned_words 테이블 엔티티 — 커뮤니티 금칙어 목록.
 * 게시글·댓글의 제목/내용/닉네임에 이 단어가 들어가면 작성이 거부된다.
 * 관리자 화면에서 조회·추가·삭제하며, 비교는 BannedWordService 가 공백·기호를 지운 정규화 형태로 한다.
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/** 커뮤니티 금칙어 (입력한 원문 그대로 저장) */
@Entity("banned_words", { comment: "커뮤니티 금칙어(게시글·댓글·닉네임 작성 차단)" })
export class BannedWord {
  /** 금칙어 ID (자동 증가) */
  @PrimaryGeneratedColumn("increment")
  id: number;

  /** 금칙어 원문 (관리자가 입력한 그대로) */
  @Index({ unique: true })
  @Column({ type: "varchar", length: 50, comment: "금칙어 원문(비교는 공백·기호 제거 후)" })
  word: string;

  /** 등록 시각 */
  @CreateDateColumn({ type: "timestamptz", comment: "등록 시각" })
  createdAt: Date;
}
