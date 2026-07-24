/**
 * costumes/dto.ts
 * ------------------------------------------------------------------
 * 코스튬 가져오기(import) 요청 검증 DTO.
 * 프론트(관리자 업로드 라우트)가 ZIP 을 해제해 이미지를 저장한 뒤,
 * 여기 정의된 형태의 JSON(rows)을 백엔드로 보내면 DB 에 upsert 한다.
 * 전역 ValidationPipe(whitelist·transform)로 검증·정제된다.
 * ------------------------------------------------------------------
 */
import { Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

/** 코스튬 1건(이미 이미지 저장이 끝난 상태의 메타데이터). */
export class CostumeRowDto {
  /** 캐릭터명(한글) */
  @IsString()
  @MaxLength(200)
  characterName: string;

  /** 출시년도 */
  @IsInt()
  @Min(1000)
  releaseYear: number;

  /** 코스튬명(한글) */
  @IsString()
  @MaxLength(200)
  costumeName: string;

  /** 저장된 이미지 웹 경로(예: /costumes/2026/luis_00.png) */
  @IsString()
  @MaxLength(500)
  imagePath: string;

  /** 원본 이미지 파일명(zip 내부 경로) — 선택 */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageFile?: string;

  /** 세트 내 정렬 순서 — 선택(미지정 시 0) */
  @IsOptional()
  @IsInt()
  seq?: number;
}

/** 코스튬 일괄 가져오기 요청. */
export class ImportCostumesDto {
  /** 저장할 코스튬 행 목록 */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CostumeRowDto)
  rows: CostumeRowDto[];

  /**
   * upsert(기본): 캐릭터·연도·코스튬명 기준으로 있으면 갱신, 없으면 추가.
   * replace: 이번 배치에 포함된 (캐릭터, 연도) 세트의 기존 행을 먼저 모두 지우고 새로 넣음
   *          (한 세트를 통째로 다시 올릴 때 — 삭제된 코스튬도 반영됨).
   */
  @IsOptional()
  @IsIn(["upsert", "replace"])
  mode?: "upsert" | "replace";
}

/** 코스튬 피드백(시세 신고 / 수정 요청) 작성 요청. */
export class CreateFeedbackDto {
  /** "price"(시세 신고) | "correction"(수정 요청) */
  @IsIn(["price", "correction"])
  kind: "price" | "correction";

  /** 시세(가격) — kind=price 일 때 필수(양수) */
  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;

  /** 시세 단위(마일리지/세리/원 등) */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  priceUnit?: string;

  /** 수정요청 대상 필드(name/year/image/etc) */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  field?: string;

  /** 내용(수정요청 본문 / 시세 메모) */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  content?: string;

  /** 작성자 닉네임(비회원) */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  authorName?: string;

  /** 본인 삭제용 비밀번호(선택 — 없으면 관리자만 삭제 가능) */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  password?: string;
}

/** 코스튬 피드백 삭제 요청(본인 비밀번호). 관리자는 x-admin-token 헤더로 대체. */
export class DeleteFeedbackDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  password?: string;
}

/** 수정 요청 상태 변경(관리자). */
export class ResolveFeedbackDto {
  @IsOptional()
  @IsIn(["open", "resolved"])
  status?: "open" | "resolved";
}
