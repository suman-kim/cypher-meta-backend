/**
 * dto.ts
 * ------------------------------------------------------------------
 * 투표 API 중 공식 역할군 체계(/votes/official/*) 요청 DTO.
 * 전역 ValidationPipe(whitelist, transform)가 여기 선언된 필드만 통과시킨다.
 * (기존 /votes/tier·/votes/comp 는 본문을 any 로 받는다 — 새 엔드포인트부터 DTO 사용)
 * ------------------------------------------------------------------
 */
import { ArrayMaxSize, IsArray, IsIn, IsObject, IsString, Length } from "class-validator";
import { OFFICIAL_FORMATIONS } from "../meta/formations";

// 공식 편성 프리셋 key 허용값 — @IsIn 검증에 사용
export const OFFICIAL_FORMATION_KEYS: string[] = OFFICIAL_FORMATIONS.map((f) => f.key);

/**
 * 공식 역할군 티어 투표 본문. POST /votes/official/tier
 */
export class OfficialTierVoteBody {
  // 방문자 식별자(클라이언트 생성)
  @IsString()
  @Length(1, 100)
  visitorId: string;

  // 역할군 영문 키 → "characterId:ultimateType" 맵. 역할군 일치 여부는 서비스에서 검증
  @IsObject()
  picks: Record<string, string>;
}

/**
 * 공식 역할군 조합 투표 본문. POST /votes/official/comp
 */
export class OfficialCompVoteBody {
  // 방문자 식별자(클라이언트 생성)
  @IsString()
  @Length(1, 100)
  visitorId: string;

  // 공식 편성 프리셋 key (OFFICIAL_FORMATION_KEYS 중 하나)
  @IsIn(OFFICIAL_FORMATION_KEYS)
  formationKey: string;

  // 슬롯 순서대로 "characterId:ultimateType" 배열(5칸)
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  units: string[];
}
