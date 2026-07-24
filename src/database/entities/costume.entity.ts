/**
 * costumes 테이블 엔티티 — 캐릭터 코스튬(치장) 카탈로그.
 * Neople 오픈API에 코스튬 엔드포인트가 없어(실측 확인) 게임 내장 "촬영" 캡처로 확보한
 * 이미지를 서버(프론트 public)에 저장하고, 메타데이터(캐릭터/연도/코스튬명/이미지경로)를 여기 보관한다.
 * 동일 캐릭터·출시년도 안에서 코스튬명은 유일하다(재업로드 시 이미지 경로만 갱신).
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";

/** 캐릭터 코스튬(치장) 카탈로그 — 캐릭터·출시년도·코스튬명이 하나의 코스튬을 식별한다. */
@Entity("costumes", { comment: "캐릭터 코스튬(치장) 카탈로그 — 게임 촬영 캡처 기반" })
@Unique("uq_costume_identity", ["characterName", "releaseYear", "costumeName"])
export class Costume {
  /** 코스튬 고유번호 (자동 증가, 기본키) */
  @PrimaryGeneratedColumn({ comment: "코스튬 고유번호" })
  id: number;

  /** 출시년도 (zip 파일명에서 파싱 — 캡처 이미지엔 없음) */
  @Index("idx_costume_year")
  @Column({ type: "int", comment: "출시년도" })
  releaseYear: number;

  /** 캐릭터명(한글) — zip 파일명에서 파싱 */
  @Index("idx_costume_character")
  @Column({ comment: "캐릭터명(한글)" })
  characterName: string;

  /** 코스튬명(한글) — 캡처 타이틀 밴드에서 판독 */
  @Column({ comment: "코스튬명(한글)" })
  costumeName: string;

  /** 서버 저장 이미지 웹 경로 (프론트 public 기준, 예: /costumes/2026/luis_00.png) */
  @Column({ comment: "서버 저장 이미지 웹 경로 (예: /costumes/2026/luis_00.png)" })
  imagePath: string;

  /** 원본 이미지 파일명(zip 내부 경로, 예: images/luis_00.png) — 재매칭·추적용 */
  @Column({ default: "", comment: "원본 이미지 파일명 (예: images/luis_00.png)" })
  imageFile: string;

  /** 세트 내 정렬 순서 — 파일명 끝 번호(luis_00 → 0). 표시 순서 유지용 */
  @Column({ type: "int", default: 0, comment: "세트 내 정렬 순서(파일명 번호)" })
  seq: number;

  /** 최초 등록 시각 */
  @CreateDateColumn({ type: "timestamptz", comment: "등록 시각" })
  createdAt: Date;

  /** 마지막 갱신 시각(재업로드 시 이미지 경로 갱신 등) */
  @UpdateDateColumn({ type: "timestamptz", comment: "수정 시각" })
  updatedAt: Date;
}
