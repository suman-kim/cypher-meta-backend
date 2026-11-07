/**
 * dto.ts
 *
 * 애널리틱스 트래킹 요청 본문(Body)과 관리자 통계·로그 조회 쿼리의 형태와 유효성 규칙을 정의하는 DTO.
 * class-validator 데코레이터로 각 필드의 타입·길이·형식을 검증한다.
 */
import { IsIn, IsOptional, IsString, Length, Matches, MaxLength } from "class-validator";
import { CLIENT_KINDS, LOG_DEVICES } from "./analytics-logic";
import type { ClientKind } from "./analytics-logic";

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

/* ───────────── 관리자 통계·로그 조회 쿼리 ───────────── */

/** 'YYYY-MM-DD' 날짜 형식 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 방문자 ID 형식(쿠키 UUID 또는 "unknown") */
const VISITOR_RE = /^[0-9A-Za-z-]{1,64}$/;
/** 목록 커서 시각 형식(UTC, 마이크로초까지) */
const CURSOR_TS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/;

/** GET /api/analytics/admin/daily · /activity/summary 쿼리 */
export class DaysQuery {
  // 최근 며칠(오늘 포함, KST). 선택, 서비스에서 1~120으로 맞춤. 기본 30.
  @IsOptional()
  @Matches(/^\d{1,3}$/, { message: "기간(days)은 숫자로 입력해 주세요." })
  days?: string;
}

/** GET /api/analytics/admin/day 쿼리 */
export class DayQuery {
  // 볼 날짜(KST) 'YYYY-MM-DD'. 필수.
  @Matches(DATE_RE, { message: "날짜는 YYYY-MM-DD 형식이어야 합니다." })
  date: string;
}

/** GET /api/analytics/admin/logs 쿼리 — 방문 로그 필터와 페이지 넘김 */
export class LogsQuery {
  // 시작 날짜(KST) 'YYYY-MM-DD'. 선택, 기본 6일 전.
  @IsOptional()
  @Matches(DATE_RE, { message: "시작 날짜는 YYYY-MM-DD 형식이어야 합니다." })
  from?: string;

  // 끝 날짜(KST, 그날 포함) 'YYYY-MM-DD'. 선택, 기본 오늘.
  @IsOptional()
  @Matches(DATE_RE, { message: "끝 날짜는 YYYY-MM-DD 형식이어야 합니다." })
  to?: string;

  // 이벤트 이름(정확히 일치). 선택.
  @IsOptional()
  @IsString()
  @MaxLength(32)
  event?: string;

  // 경로 또는 검색어에 들어 있는 글자. 선택, 최대 100자.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  text?: string;

  // 기기 유형(desktop/mobile/tablet). 선택.
  @IsOptional()
  @IsIn([...LOG_DEVICES], { message: "기기 유형은 desktop, mobile, tablet 중 하나여야 합니다." })
  device?: string;

  // 앱/웹(app/web). 선택.
  @IsOptional()
  @IsIn([...CLIENT_KINDS], { message: "앱/웹 구분은 app 또는 web 이어야 합니다." })
  client?: ClientKind;

  // 방문자 ID(정확히 일치). 선택.
  @IsOptional()
  @Matches(VISITOR_RE, { message: "방문자 ID 형식이 올바르지 않습니다." })
  visitorId?: string;

  // 검색 로봇 포함 여부("1"이면 포함). 선택, 기본 제외.
  @IsOptional()
  @IsIn(["0", "1"], { message: "로봇 포함 여부(bots)는 0 또는 1 이어야 합니다." })
  bots?: string;

  // 다음 페이지 커서('시각|ID', 이전 응답의 nextCursor). 선택.
  @IsOptional()
  @IsString()
  @MaxLength(120)
  cursor?: string;

  // 한 페이지 건수. 선택, 서비스에서 1~100으로 맞춤. 기본 50.
  @IsOptional()
  @Matches(/^\d{1,3}$/, { message: "건수(limit)는 숫자로 입력해 주세요." })
  limit?: string;
}

/** GET /api/analytics/admin/visitor 쿼리 */
export class VisitorQuery {
  // 요약을 볼 방문자 ID. 필수.
  @Matches(VISITOR_RE, { message: "방문자 ID 형식이 올바르지 않습니다." })
  visitorId: string;
}

/** GET /api/analytics/admin/activity 쿼리 — 사이트 활동 목록 */
export class ActivityQuery {
  // 볼 활동 종류(쉼표로 구분, 예: "post,comment"). 선택, 기본 전체. 서비스에서 알 수 없는 종류는 400.
  @IsOptional()
  @Matches(/^[a-z_]+(,[a-z_]+)*$/, { message: "활동 종류 형식이 올바르지 않습니다." })
  types?: string;

  // 이 시각보다 이전 활동부터(이전 응답의 nextBefore). 선택.
  @IsOptional()
  @Matches(CURSOR_TS_RE, { message: "before 형식이 올바르지 않습니다." })
  before?: string;

  // 한 페이지 건수. 선택, 서비스에서 1~100으로 맞춤. 기본 50.
  @IsOptional()
  @Matches(/^\d{1,3}$/, { message: "건수(limit)는 숫자로 입력해 주세요." })
  limit?: string;
}
