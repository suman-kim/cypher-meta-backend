/**
 * ultimate_items 테이블 엔티티 — 1차/2차 궁극기 판별 기준 아이템 표.
 *
 * 캐릭터 전용 아이템의 옵션 설명(explainDetail)에 한쪽 궁극기 스킬명만 적혀 있으면
 * 그 아이템을 낀 판은 해당 궁극기를 쓴 것으로 판별한다(예: 쉬베르트 루프리 SU → 다이무스 2차).
 *  - ultimateType=null 행은 "확인했지만 판별 근거가 아닌 아이템"이다. 신규 아이템 학습 시
 *    같은 아이템을 매번 다시 조회하지 않도록 확인 완료 표시로 남긴다.
 *  - 규칙 분석 기준(2026-09): 판별 근거 아이템 890종(목·장신구4·특수킷), 판별률 99.57%, 충돌 0.
 */
import { Column, Entity, Index, PrimaryColumn, UpdateDateColumn } from "typeorm";
import type { UltimateType } from "./character-ultimate.entity";

/** 궁극기 판별 기준 아이템 (아이템 ID → 1차/2차) */
@Entity("ultimate_items", { comment: "궁극기 판별 기준 아이템(아이템→1차/2차, null=중립 확인완료)" })
@Index(["characterId"])
export class UltimateItem {
  /** 아이템 ID (Neople itemId) */
  @PrimaryColumn({ comment: "아이템 ID(Neople itemId)" })
  itemId: string;

  /** 전용 캐릭터 ID */
  @Column({ comment: "전용 캐릭터 ID" })
  characterId: string;

  /** 이 아이템이 가리키는 궁극기 ("1st"/"2nd"). null=판별 근거 아님(확인 완료) */
  @Column({ type: "varchar", nullable: true, comment: "가리키는 궁극기(1st/2nd), null=중립" })
  ultimateType: UltimateType | null;

  /** 옵션 설명에서 매칭된 궁극기 스킬명 (판별 근거 확인용) */
  @Column({ type: "varchar", nullable: true, comment: "옵션에서 매칭된 궁극기 스킬명" })
  matchedSkill: string | null;

  /** 아이템명 (검수용 스냅샷) */
  @Column({ type: "varchar", nullable: true, comment: "아이템명(스냅샷)" })
  itemName: string | null;

  /** 슬롯명 (목/장신구4/특수킷 등) */
  @Column({ type: "varchar", nullable: true, comment: "슬롯명" })
  slotName: string | null;

  /** 마지막 수정 시각 */
  @UpdateDateColumn({ type: "timestamptz", comment: "수정 시각" })
  updatedAt: Date;
}
