/**
 * dto.ts
 * ------------------------------------------------------------------
 * 메타(meta) API 중 공식 역할군·궁극기 단위 엔드포인트의 요청 DTO.
 * 전역 ValidationPipe(whitelist, transform)가 여기 선언된 필드만 통과시킨다.
 * (기존 meta 엔드포인트는 @Query 문자열을 직접 받는다 — 새 엔드포인트부터 DTO 사용)
 * ------------------------------------------------------------------
 */
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from "class-validator";
import { Type } from "class-transformer";

/** 궁극기 구분 허용값 — 1차·2차 */
export const ULTIMATE_TYPE_VALUES = ["1st", "2nd"];

/**
 * 캐릭터 아이템 채용 통계 쿼리. GET /meta/characters/:id/items
 */
export class CharacterItemsQuery {
  // 궁극기 구분(선택) — 지정 시 그 궁극기로 판별된 판만 집계
  @IsOptional()
  @IsIn(ULTIMATE_TYPE_VALUES)
  ultimateType?: string;
}

/** 조합 인원 허용값 — 2인(듀오)·3인(트리오) */
export const COMPOSITION_SIZES = [2, 3];

/**
 * 궁극기 단위 조합 집계 쿼리. GET /meta/compositions/ultimates
 */
export class UltimateCompositionsQuery {
  // 게임 타입(선택, 기본 rating)
  @IsOptional()
  @IsString()
  gameTypeId?: string;

  // 조합 인원(선택, 기본 2) — 2 또는 3
  @IsOptional()
  @Type(() => Number)
  @IsIn(COMPOSITION_SIZES)
  size?: number;

  // 역할군 구성 필터(선택) — 공식 역할군 영문 키 쉼표 목록(중복 허용). 예: "vanguard,ranger"
  // 조합의 역할군 구성이 이 목록을 모두 포함해야 통과(부분 포함). 비우면 전체.
  @IsOptional()
  @IsString()
  roles?: string;

  // 목록별 반환 조합 수(선택, 1~50, 기본 10)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  // 승률순 최소 표본 경기 수(선택, 기본 3)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minGames?: number;
}

/** 플레이어 비교 기준 허용값 — 전체·공식전·일반전 */
export const DUO_GAME_TYPES = ["all", "rating", "normal"];

/** Neople playerId 형식(32자리 16진수) */
export const PLAYER_ID_PATTERN = /^[0-9a-f]{32}$/i;

/**
 * 플레이어 2명 비교 쿼리. GET /meta/history/duo
 */
export class PlayerDuoQuery {
  // 플레이어 A ID(필수) — Neople playerId
  @Matches(PLAYER_ID_PATTERN, { message: "a 는 올바른 플레이어 ID 가 아닙니다." })
  a: string;

  // 플레이어 B ID(필수) — Neople playerId
  @Matches(PLAYER_ID_PATTERN, { message: "b 는 올바른 플레이어 ID 가 아닙니다." })
  b: string;

  // 비교 기준(선택, 기본 all) — all | rating | normal
  @IsOptional()
  @IsIn(DUO_GAME_TYPES)
  gameType?: string;

  // 플레이어 A 닉네임(선택) — 처음 보는 플레이어를 적립 대상에 등록할 때 이름으로 저장
  @IsOptional()
  @IsString()
  @Length(1, 30)
  an?: string;

  // 플레이어 B 닉네임(선택)
  @IsOptional()
  @IsString()
  @Length(1, 30)
  bn?: string;
}
