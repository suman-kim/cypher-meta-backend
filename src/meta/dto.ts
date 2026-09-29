/**
 * dto.ts
 * ------------------------------------------------------------------
 * 메타(meta) API 중 공식 역할군·궁극기 단위 엔드포인트의 요청 DTO.
 * 전역 ValidationPipe(whitelist, transform)가 여기 선언된 필드만 통과시킨다.
 * (기존 meta 엔드포인트는 @Query 문자열을 직접 받는다 — 새 엔드포인트부터 DTO 사용)
 * ------------------------------------------------------------------
 */
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { Type } from "class-transformer";

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
