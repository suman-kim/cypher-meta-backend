import { IsIn, IsInt, IsOptional, IsString, Length, Min } from "class-validator";
import { Type } from "class-transformer";

export const BOARD_TYPES: string[] = ["free", "guide", "humor", "video"];
export const CATEGORIES: string[] = ["free", "question", "info", "discussion"];

export class ListPostsQuery {
  @IsOptional()
  @IsIn(BOARD_TYPES)
  board?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;

  @IsOptional()
  @IsString()
  q?: string;
}

export class TrendingQuery {
  @IsOptional()
  @IsIn(BOARD_TYPES)
  board?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class CreatePostDto {
  @IsIn(BOARD_TYPES)
  board: string;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: string;

  @IsString()
  @Length(1, 120)
  title: string;

  @IsString()
  @Length(1, 20000)
  content: string;

  /** 비회원 작성자 닉네임 */
  @IsString()
  @Length(1, 20)
  guestName: string;

  /** 비회원 비밀번호 (수정/삭제용) */
  @IsString()
  @Length(1, 30)
  password: string;
}

export class CreateCommentDto {
  @IsString()
  @Length(1, 2000)
  content: string;

  @IsString()
  @Length(1, 20)
  guestName: string;

  @IsString()
  @Length(1, 30)
  password: string;
}

export class PasswordDto {
  @IsString()
  @Length(1, 30)
  password: string;
}
