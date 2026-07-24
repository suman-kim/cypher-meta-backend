/**
 * dto.ts
 *
 * 애널리틱스 트래킹 요청 본문(Body)의 형태와 유효성 규칙을 정의하는 DTO.
 * class-validator 데코레이터로 각 필드의 타입·길이를 검증한다.
 */
import { IsOptional, IsString, Length, MaxLength } from "class-validator";

/**
 * POST /api/analytics/track 요청 본문 DTO.
 * path 만 필수이며 나머지는 선택값이다. 각 필드는 DB 컬럼 한도에 맞춘 최대 길이를 가진다.
 */
export class TrackDto {
  // 방문/이벤트가 발생한 경로. 필수, 1~512자.
  @IsString()
  @Length(1, 512)
  path: string;

  // 이벤트 종류(예: "pageview", "search"). 선택, 최대 32자. 미지정 시 서비스에서 "pageview".
  @IsOptional()
  @IsString()
  @MaxLength(32)
  event?: string;

  // 유입 리퍼러 URL. 선택, 최대 1024자.
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  referrer?: string;

  // 검색 이벤트의 검색어. 선택, 최대 190자.
  @IsOptional()
  @IsString()
  @MaxLength(190)
  query?: string;

  // 방문자 식별자(익명 ID). 선택, 최대 64자. 미지정 시 서비스에서 "unknown".
  @IsOptional()
  @IsString()
  @MaxLength(64)
  visitorId?: string;

  // 방문자 IP(프론트 프록시가 채움). 선택, 최대 64자.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ip?: string;

  // 국가 코드(예: "KR"). 선택, 최대 8자.
  @IsOptional()
  @IsString()
  @MaxLength(8)
  country?: string;

  // 도시명. 선택, 최대 128자.
  @IsOptional()
  @IsString()
  @MaxLength(128)
  city?: string;

  // 원본 User-Agent 문자열(browser/os/device 파싱에 사용). 선택, 최대 1024자.
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  userAgent?: string;
}
