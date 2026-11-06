/**
 * moderation/dto.ts — 신고 API 요청 검증 DTO.
 * 허용값 목록은 report-logic.ts 의 상수를 그대로 써서 서비스와 검증이 어긋나지 않게 한다.
 */
import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from "class-validator";
import {
  REPORT_ACTIONS,
  REPORT_REASONS,
  REPORT_TARGET_TYPES,
  REPORT_VIEWS,
  type ReportAction,
  type ReportReason,
  type ReportTargetType,
  type ReportView,
} from "./report-logic";

/** 대상 ID 허용 형식(영문·숫자·하이픈 1~64자) */
const TARGET_ID_RE = /^[0-9A-Za-z-]{1,64}$/;

/** 신고 넣기 — POST /moderation/reports */
export class CreateReportDto {
  /** 신고 대상 종류(post / comment / update_comment) */
  @IsIn(REPORT_TARGET_TYPES)
  targetType: ReportTargetType;

  /** 신고 대상 ID(영문·숫자·하이픈, 64자까지 — 대상별 형식은 ReportTarget 이 다시 확인) */
  @IsString()
  @Matches(TARGET_ID_RE)
  targetId: string;

  /** 신고 사유(spam / abuse / sexual / illegal / privacy / other) */
  @IsIn(REPORT_REASONS)
  reason: ReportReason;

  /** 상세 설명(선택, 500자까지) */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  detail?: string;

  /** 신고자 임의 ID(브라우저가 만들어 보관하는 값, 서버는 해시만 저장) */
  @IsString()
  @Length(8, 64)
  reporterKey: string;
}

/** 관리자 신고 목록 — GET /moderation/admin/reports */
export class AdminReportsQuery {
  /** 보기(pending 대기 중 / handled 처리됨). 기본 pending */
  @IsOptional()
  @IsIn(REPORT_VIEWS)
  view?: ReportView;

  /** 페이지(1부터). 기본 1 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** 페이지당 묶음 수. 기본 20, 최대 50 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number;
}

/** 관리자 신고 처리 — POST /moderation/admin/reports/resolve */
export class ResolveReportDto {
  /** 처리할 대상 종류 */
  @IsIn(REPORT_TARGET_TYPES)
  targetType: ReportTargetType;

  /** 처리할 대상 ID */
  @IsString()
  @Matches(TARGET_ID_RE)
  targetId: string;

  /** 처리 방법(delete 대상 삭제 / dismiss 문제없음) */
  @IsIn(REPORT_ACTIONS)
  action: ReportAction;

  /** 작성자 닉네임을 금칙어에 넣어 그 닉네임으로 더 쓰지 못하게 할지(선택, 기본 false) */
  @IsOptional()
  @IsBoolean()
  banAuthor?: boolean;
}
