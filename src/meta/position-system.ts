/**
 * position-system.ts
 * ---------------------------------------------------------------------------
 * 포지션 체계 정의와 전환 스위치.
 *
 *  - official : 사이퍼즈 공식 역할군 7종(궁극기별) — 기본값
 *  - legacy   : 기존 자체 포지션 4종(탱커/근접딜러/원거리딜러/서포터, match_players.role)
 *
 * 공식 역할군이 패치로 바뀌거나 폐지되면 env POSITION_SYSTEM=legacy 로 되돌린다.
 * 그래서 legacy 판별값(role/roleSource)은 official 모드에서도 계속 수집·저장한다.
 */
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/** 포지션 체계 값 목록 (DTO @IsIn 과 공유) */
export const POSITION_SYSTEMS = ["official", "legacy"] as const;
/** 포지션 체계 타입 */
export type PositionSystem = (typeof POSITION_SYSTEMS)[number];

/**
 * 공식 역할군 7종 — 표시 순서(전방 → 후방 → 지원)와 URL 용 영문 키.
 * name 은 Neople /characters role[].name, character_ultimates.officialRole 과 같은 한글 표기다.
 */
export const OFFICIAL_ROLES = [
  { key: "vanguard", name: "뱅가드" },
  { key: "striker", name: "스트라이커" },
  { key: "skirmisher", name: "스커미셔" },
  { key: "reaper", name: "리퍼" },
  { key: "ranger", name: "레인저" },
  { key: "artillery", name: "아틸러리" },
  { key: "controller", name: "컨트롤러" },
] as const;

/** 현재 포지션 체계를 env(POSITION_SYSTEM)에서 읽어 주는 서비스 */
@Injectable()
export class PositionSystemService {
  /** @param env — 환경변수 접근(ConfigService) */
  constructor(private readonly env: ConfigService) {}

  /**
   * 현재 포지션 체계. 값이 없거나 잘못되면 official.
   * @returns "official" | "legacy"
   */
  current(): PositionSystem {
    const v = this.env.get<string>("POSITION_SYSTEM", "official");
    return (POSITION_SYSTEMS as readonly string[]).includes(v) ? (v as PositionSystem) : "official";
  }

  /**
   * 프론트가 화면 구성을 정할 때 쓰는 설정 요약.
   * @returns 현재 체계와 공식 역할군 목록
   */
  describe(): { system: PositionSystem; officialRoles: typeof OFFICIAL_ROLES } {
    return { system: this.current(), officialRoles: OFFICIAL_ROLES };
  }
}
