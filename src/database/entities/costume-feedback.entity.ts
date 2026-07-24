/**
 * costume_feedback 테이블 엔티티 — 코스튬별 사용자 피드백.
 *  - kind="price"      : 현재 시세 신고(price + priceUnit, content=메모)
 *  - kind="correction" : 정보 수정 요청(field=대상, content=내용, status=open/resolved)
 * 비회원 작성(닉네임 + 선택 비밀번호 해시)으로, 비밀번호를 남기면 본인이 삭제할 수 있고
 * 관리자(x-admin-token)는 항상 삭제/상태변경이 가능하다.
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

/** 코스튬 시세 신고 / 수정 요청 */
@Entity("costume_feedback", { comment: "코스튬 시세 신고 / 수정 요청" })
export class CostumeFeedback {
  /** 고유 ID (자동 증가, 기본키) */
  @PrimaryGeneratedColumn()
  id: number;

  /** 대상 코스튬 id (costumes.id 참조) */
  @Index("idx_cfb_costume")
  @Column({ type: "int", comment: "대상 코스튬 id" })
  costumeId: number;

  /** "price"(시세 신고) | "correction"(수정 요청) */
  @Index("idx_cfb_kind")
  @Column({ comment: "price=시세신고 / correction=수정요청" })
  kind: string;

  /** 신고 시세(가격). bigint 라 조회 시 문자열로 반환됨 */
  @Column({ type: "bigint", nullable: true, comment: "신고 시세(가격)" })
  price: string | null;

  /** 시세 단위(마일리지/세리/원 등) */
  @Column({ default: "", comment: "시세 단위" })
  priceUnit: string;

  /** 수정요청 대상 필드(name/year/image/etc) */
  @Column({ default: "", comment: "수정요청 대상 필드" })
  field: string;

  /** 내용(수정요청 본문 / 시세 메모) */
  @Column({ type: "text", default: "", comment: "내용(수정요청 본문/시세 메모)" })
  content: string;

  /** 작성자 표시명(비회원 닉네임, 미입력 시 null → '익명') */
  @Column({ type: "varchar", nullable: true, comment: "작성자 닉네임(비회원)" })
  authorName: string | null;

  /** 비회원 비밀번호 해시(본인 삭제용). select:false 로 기본 조회 제외 */
  @Column({
    type: "varchar",
    nullable: true,
    select: false,
    comment: "비회원 비밀번호 해시(삭제용)",
  })
  guestPassword: string | null;

  /** 상태 — 수정요청: open/resolved (시세는 항상 open) */
  @Column({ default: "open", comment: "상태(수정요청: open/resolved)" })
  status: string;

  /** 작성 시각 */
  @CreateDateColumn({ type: "timestamptz", comment: "작성 시각" })
  createdAt: Date;
}
