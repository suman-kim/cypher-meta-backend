/**
 * dto.ts — 업데이트 노트(패치노트) API 요청 DTO 및 검증 규칙.
 * class-validator/class-transformer 데코레이터로 쿼리/본문의 타입·범위를 검증한다.
 * 공개 목록 조회용과 관리자 작성/수정용 DTO 를 함께 정의한다.
 */
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Min } from "class-validator";
import { Type } from "class-transformer";

/**
 * 비회원 댓글 작성 본문 DTO.
 * POST /updates/:id/comments 요청 본문을 검증한다.
 */
export class CreateUpdateCommentDto {
  // 작성자 닉네임(필수). 1~20자
  @IsString()
  @Length(1, 20)
  guestName: string;

  // 비회원 비밀번호(필수, 삭제용). 1~30자
  @IsString()
  @Length(1, 30)
  password: string;

  // 댓글 내용(필수). 1~2000자
  @IsString()
  @Length(1, 2000)
  content: string;

  // 부모 댓글 ID(대댓글). 없으면 최상위 댓글
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

/**
 * 댓글 삭제용 비밀번호 본문 DTO.
 * POST /updates/comments/:cid/delete 요청 본문을 검증한다.
 */
export class DeleteUpdateCommentDto {
  // 비회원 비밀번호(필수). 1~30자
  @IsString()
  @Length(1, 30)
  password: string;
}

/**
 * 공개 목록 조회 쿼리 DTO.
 * GET /updates 의 쿼리스트링(limit/offset)을 검증한다.
 */
export class ListUpdatesQuery {
  // 가져올 개수(선택). 숫자 정수 1 이상
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  // 건너뛸 개수(선택, 페이지네이션). 숫자 정수 0 이상
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/**
 * 관리자용 업데이트 노트 작성 본문 DTO.
 * POST /updates/admin 의 요청 본문을 검증한다.
 */
export class CreateUpdateDto {
  // 버전 라벨(선택). 최대 40자
  @IsOptional()
  @IsString()
  @Length(0, 40)
  version?: string;

  // 제목(필수). 1~120자
  @IsString()
  @Length(1, 120)
  title: string;

  // 본문(필수). 1~20000자
  @IsString()
  @Length(1, 20000)
  content: string;

  // 발행 여부(선택). 미지정 시 서비스 기본값 true
  @IsOptional()
  @IsBoolean()
  published?: boolean;
}

/**
 * 관리자용 업데이트 노트 수정 본문 DTO(모든 필드 선택적, 부분 수정).
 * POST /updates/admin/:id/update 의 요청 본문을 검증한다.
 */
export class UpdateUpdateDto {
  // 버전 라벨(선택). 최대 40자
  @IsOptional()
  @IsString()
  @Length(0, 40)
  version?: string;

  // 제목(선택). 지정 시 1~120자
  @IsOptional()
  @IsString()
  @Length(1, 120)
  title?: string;

  // 본문(선택). 지정 시 1~20000자
  @IsOptional()
  @IsString()
  @Length(1, 20000)
  content?: string;

  // 발행 여부(선택)
  @IsOptional()
  @IsBoolean()
  published?: boolean;
}
