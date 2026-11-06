/**
 * content_reports 테이블 엔티티 — 사용자가 신고한 글·댓글(Google Play 사용자 제작 콘텐츠 정책 대응).
 *
 * 신고 1건 = 1행. 같은 대상(targetType + targetId)에 들어온 신고는 관리자 화면에서 하나로 묶어 보여 준다.
 * 로그인이 없으므로 신고자는 브라우저가 만든 임의 ID 의 SHA-256 해시(reporterHash)로만 구분하며,
 * 같은 사람이 같은 대상을 두 번 신고하지 못하게 (대상, 신고자) 유일 인덱스를 둔다.
 * 작성자가 글을 지워도 관리자가 확인할 수 있도록 신고 당시 제목·본문·닉네임 사본을 함께 저장한다.
 * 운영 DB(DB_SYNC=false)는 sql/2026-11-07_content_reports.sql 로 테이블을 만든다. 이름·타입을 바꾸면 SQL도 함께 고칠 것.
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/** 사용자 신고 1건 */
@Entity("content_reports", { comment: "사용자 신고(커뮤니티 글·댓글, 업데이트 댓글)" })
@Index("UQ_content_reports_reporter", ["targetType", "targetId", "reporterHash"], { unique: true })
@Index("IDX_content_reports_status", ["status", "createdAt"])
export class ContentReport {
  /** 신고 ID (UUID 자동 생성, 기본키) */
  @PrimaryGeneratedColumn("uuid", { primaryKeyConstraintName: "PK_content_reports", comment: "신고 ID" })
  id: string;

  /** 신고 대상 종류 — post(커뮤니티 글) / comment(커뮤니티 댓글) / update_comment(업데이트 노트 댓글) */
  @Column({ type: "varchar", length: 20, comment: "신고 대상 종류(post/comment/update_comment)" })
  targetType: string;

  /**
   * 신고 대상 ID — posts.id / comments.id / update_comments.id (지금은 모두 UUID).
   * 숫자 ID 를 쓰는 대상(예: 코스튬 제보)도 붙일 수 있게 문자열로 둔다. 형식 검사는 대상별 ReportTarget 이 한다.
   */
  @Column({ type: "varchar", length: 64, comment: "신고 대상 ID(posts.id / comments.id / update_comments.id, 문자열)" })
  targetId: string;

  /** 신고 사유 — spam / abuse / sexual / illegal / privacy / other (moderation/report-logic.ts 의 REPORT_REASONS) */
  @Column({ type: "varchar", length: 20, comment: "신고 사유(spam/abuse/sexual/illegal/privacy/other)" })
  reason: string;

  /** 신고자가 적은 상세 설명(선택, 500자까지) */
  @Column({ type: "text", nullable: true, comment: "상세 설명(선택)" })
  detail: string | null;

  /** 신고자 구분값 — 브라우저가 만든 임의 ID 의 SHA-256 해시(16진수 64자). 중복 신고·과다 신고 방지용 */
  @Column({ type: "varchar", length: 64, comment: "신고자 임의 ID 의 SHA-256 해시(중복 신고 방지)" })
  reporterHash: string;

  /** 처리 상태 — pending(대기) / deleted(삭제함) / dismissed(문제없음) */
  @Column({ type: "varchar", length: 16, default: "pending", comment: "처리 상태(pending/deleted/dismissed)" })
  status: string;

  /** 신고 당시 제목 사본(글만, 댓글은 null 또는 소속 글 제목) */
  @Column({ type: "varchar", length: 200, nullable: true, comment: "신고 당시 제목 사본" })
  snapshotTitle: string | null;

  /** 신고 당시 본문 사본(최대 2,000자) */
  @Column({ type: "text", comment: "신고 당시 본문 사본(최대 2000자)" })
  snapshotContent: string;

  /** 신고 당시 작성자 닉네임 사본 */
  @Column({ type: "varchar", length: 40, nullable: true, comment: "신고 당시 작성자 닉네임 사본" })
  snapshotAuthor: string | null;

  /** 관리자가 대상을 열어 볼 화면 경로(예: /community/free/<글ID>) */
  @Column({ type: "varchar", length: 300, nullable: true, comment: "대상 화면 경로" })
  targetLink: string | null;

  /** 신고 시각 */
  @CreateDateColumn({ type: "timestamptz", comment: "신고 시각" })
  createdAt: Date;

  /** 관리자가 처리한 시각(대기 중이면 null) */
  @Column({ type: "timestamptz", nullable: true, comment: "처리 시각(대기 중 null)" })
  handledAt: Date | null;
}
