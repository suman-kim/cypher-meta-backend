/**
 * character_ultimates 테이블 엔티티 — 캐릭터별 1차/2차 궁극기 확정 표.
 *
 * Neople /characters 는 궁극기별 공식 역할군(role[].type=1st/2nd, name)만 주고
 * 궁극기 스킬 이름은 주지 않는다. 매치 응답에도 "그 판에 어느 궁극기를 썼는지"가 없으므로,
 * 장착 아이템 옵션에 적힌 궁극기 스킬명으로 판별하려면 이 표가 기준이 된다.
 *  - 캐릭터마다 1st 1행(85명), 2차 궁극기가 있는 캐릭터는 2nd 1행 추가(54명) → 총 139행.
 *  - 공식 역할군이 패치로 바뀌면 이 표만 고치면 전체 집계에 반영된다(match_players 에 역할군을 저장하지 않음).
 */
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

/** 궁극기 구분 값 — Neople role[].type 과 동일한 표기 */
export const ULTIMATE_TYPES = ["1st", "2nd"] as const;
/** 궁극기 구분 타입 ("1st"=1차, "2nd"=2차) */
export type UltimateType = (typeof ULTIMATE_TYPES)[number];

/** 캐릭터별 1차/2차 궁극기 정의 (궁극기 판별·공식 역할군 조회의 기준 표) */
@Entity("character_ultimates", { comment: "캐릭터별 1차/2차 궁극기 확정 표(궁극기 판별·공식 역할군 기준)" })
export class CharacterUltimate {
  /** 캐릭터 ID (Neople characterId) — 복합 PK 1 */
  @PrimaryColumn({ comment: "캐릭터 ID(Neople characterId)" })
  characterId: string;

  /** 궁극기 구분 ("1st"/"2nd") — 복합 PK 2 */
  @PrimaryColumn({ type: "varchar", comment: "궁극기 구분(1st/2nd)" })
  ultimateType: UltimateType;

  /** 캐릭터명 (표시·검수용) */
  @Column({ type: "varchar", comment: "캐릭터명" })
  characterName: string;

  /** 궁극기 스킬명 (예: 드라그노프). 아이템 옵션 설명의 "스킬명(E)"과 대조하는 키 */
  @Column({ type: "varchar", comment: "궁극기 스킬명(아이템 옵션 대조 키)" })
  skillName: string;

  /** 이 궁극기 선택 시 공식 역할군 (뱅가드/스트라이커/스커미셔/리퍼/레인저/아틸러리/컨트롤러) */
  @Column({ type: "varchar", comment: "공식 역할군(이 궁극기 선택 시)" })
  officialRole: string;

  /** 1차/2차 구분을 외부 자료(공식 가이드·패치 공지 등)로 검수했는지 */
  @Column({ type: "boolean", default: false, comment: "1차/2차 구분 외부 검수 여부" })
  verified: boolean;

  /** 마지막 수정 시각 */
  @UpdateDateColumn({ type: "timestamptz", comment: "수정 시각" })
  updatedAt: Date;
}
