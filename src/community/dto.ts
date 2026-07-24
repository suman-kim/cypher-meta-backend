/**
 * dto.ts
 * ------------------------------------------------------------------
 * 커뮤니티(게시판) API 의 요청 DTO 및 검증 규칙 모음.
 * class-validator/class-transformer 데코레이터로 들어오는 쿼리/본문의
 * 타입·범위·허용값을 검증하며, 일반 사용자용과 관리자용 DTO 를 함께 정의한다.
 * ------------------------------------------------------------------
 */
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Min } from "class-validator";
import { Type } from "class-transformer";

// 허용되는 게시판 타입 목록: 자유/공략/유머/영상.
// DTO 의 @IsIn(BOARD_TYPES) 검증에 사용된다.
export const BOARD_TYPES: string[] = ["free", "guide", "humor", "video"];
// 허용되는 글 카테고리 목록: 자유/질문/정보/토론.
// DTO 의 @IsIn(CATEGORIES) 검증에 사용된다.
export const CATEGORIES: string[] = ["free", "question", "info", "discussion"];

/**
 * 게시글 목록 조회 쿼리 파라미터 DTO.
 * GET /community/posts 의 쿼리스트링을 검증한다.
 */
export class ListPostsQuery {
  // 게시판 타입(선택). 지정 시 BOARD_TYPES 중 하나여야 함
  @IsOptional()
  @IsIn(BOARD_TYPES)
  board?: string;

  // 페이지 번호(선택). 숫자로 변환된 정수이며 1 이상
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  // 페이지당 항목 수(선택). 숫자로 변환된 정수이며 1 이상
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;

  // 제목/내용 검색어(선택). 문자열
  @IsOptional()
  @IsString()
  q?: string;
}

/**
 * 트렌딩 게시글 조회 쿼리 파라미터 DTO.
 * GET /community/posts/trending 의 쿼리스트링을 검증한다.
 */
export class TrendingQuery {
  // 게시판 타입(선택). 지정 시 BOARD_TYPES 중 하나여야 함
  @IsOptional()
  @IsIn(BOARD_TYPES)
  board?: string;

  // 가져올 상위 개수(선택). 숫자로 변환된 정수이며 1 이상
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

/**
 * 비회원 게시글 작성 본문 DTO.
 * POST /community/posts 의 요청 본문을 검증한다.
 */
export class CreatePostDto {
  // 게시판 타입(필수). BOARD_TYPES 중 하나여야 함
  @IsIn(BOARD_TYPES)
  board: string;

  // 글 카테고리(선택). 지정 시 CATEGORIES 중 하나여야 함
  @IsOptional()
  @IsIn(CATEGORIES)
  category?: string;

  // 글 제목(필수). 1~120자 문자열
  @IsString()
  @Length(1, 120)
  title: string;

  // 글 본문(필수). 1~20000자 문자열
  @IsString()
  @Length(1, 20000)
  content: string;

  // 비회원 작성자 닉네임(필수). 1~20자 문자열
  /** 비회원 작성자 닉네임 */
  @IsString()
  @Length(1, 20)
  guestName: string;

  // 비회원 비밀번호(필수, 수정/삭제용). 1~30자 문자열
  /** 비회원 비밀번호 (수정/삭제용) */
  @IsString()
  @Length(1, 30)
  password: string;
}

/**
 * 비회원 댓글 작성 본문 DTO.
 * POST /community/posts/:id/comments 의 요청 본문을 검증한다.
 */
export class CreateCommentDto {
  // 댓글 내용(필수). 1~2000자 문자열
  @IsString()
  @Length(1, 2000)
  content: string;

  // 비회원 작성자 닉네임(필수). 1~20자 문자열
  @IsString()
  @Length(1, 20)
  guestName: string;

  // 비회원 비밀번호(필수, 삭제용). 1~30자 문자열
  @IsString()
  @Length(1, 30)
  password: string;
}

/**
 * 비밀번호 확인용 본문 DTO.
 * 게시글/댓글 삭제(POST .../delete) 시 비회원 비밀번호를 담는다.
 */
export class PasswordDto {
  // 비회원 비밀번호(필수). 1~30자 문자열
  @IsString()
  @Length(1, 30)
  password: string;
}


/* ── 관리자(게시판/공지 관리) DTO ── */

/**
 * 관리자용 전체 글 목록 조회 쿼리 파라미터 DTO.
 * GET /community/admin/posts 의 쿼리스트링을 검증한다.
 */
export class AdminListQuery {
  // 페이지 번호(선택). 숫자로 변환된 정수이며 1 이상
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  // 페이지당 항목 수(선택). 숫자로 변환된 정수이며 1 이상
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;

  // 제목/내용 검색어(선택). 문자열
  @IsOptional()
  @IsString()
  q?: string;

  // 게시판 타입 필터(선택). 지정 시 BOARD_TYPES 중 하나여야 함
  @IsOptional()
  @IsIn(BOARD_TYPES)
  board?: string;

  // 공지만 조회할지 여부(선택). 문자열 "true" 이면 공지(isNotice=true)만 필터
  /** "true" 면 공지(isNotice=true)만 */
  @IsOptional()
  @IsString()
  noticeOnly?: string;
}

/**
 * 관리자용 공지/글 작성 본문 DTO.
 * POST /community/admin/posts 의 요청 본문을 검증한다.
 */
export class AdminCreatePostDto {
  // 게시판 타입(필수). BOARD_TYPES 중 하나여야 함
  @IsIn(BOARD_TYPES)
  board: string;

  // 글 카테고리(선택). 지정 시 CATEGORIES 중 하나여야 함
  @IsOptional()
  @IsIn(CATEGORIES)
  category?: string;

  // 글 제목(필수). 1~120자 문자열
  @IsString()
  @Length(1, 120)
  title: string;

  // 글 본문(필수). 1~20000자 문자열
  @IsString()
  @Length(1, 20000)
  content: string;

  // 공지 지정 여부(선택). true/false (미지정 시 서비스 기본값 true)
  @IsOptional()
  @IsBoolean()
  isNotice?: boolean;

  // 작성자명(선택). 1~20자 문자열 (미지정 시 서비스 기본값 "관리자")
  @IsOptional()
  @IsString()
  @Length(1, 20)
  authorName?: string;
}

/**
 * 관리자용 글/공지 수정 본문 DTO.
 * POST /community/admin/posts/:id/update 의 요청 본문을 검증한다(모든 필드 선택적, 부분 수정).
 */
export class AdminUpdatePostDto {
  // 게시판 타입(선택). 지정 시 BOARD_TYPES 중 하나여야 함
  @IsOptional()
  @IsIn(BOARD_TYPES)
  board?: string;

  // 글 카테고리(선택). 지정 시 CATEGORIES 중 하나여야 함
  @IsOptional()
  @IsIn(CATEGORIES)
  category?: string;

  // 글 제목(선택). 지정 시 1~120자 문자열
  @IsOptional()
  @IsString()
  @Length(1, 120)
  title?: string;

  // 글 본문(선택). 지정 시 1~20000자 문자열
  @IsOptional()
  @IsString()
  @Length(1, 20000)
  content?: string;

  // 공지 지정 여부(선택). true/false
  @IsOptional()
  @IsBoolean()
  isNotice?: boolean;
}

/**
 * 관리자용 공지 지정/해제 본문 DTO.
 * POST /community/admin/posts/:id/notice 의 요청 본문을 검증한다.
 */
export class AdminNoticeDto {
  // 공지 지정 여부(필수). true=공지 지정, false=해제
  @IsBoolean()
  isNotice: boolean;
}
