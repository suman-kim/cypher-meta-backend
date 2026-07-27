/**
 * player_matches 테이블 엔티티 — "개인 히스토리 분석"용으로 적립하는,
 * 플레이어 1명 관점의 매치 1건 = 1행. (메타 집계용 match_players 와 목적이 다르다:
 * 이쪽은 대상 플레이어 본인의 행만 저장하고, 연/월/포지션 분석의 원천이 된다.)
 *
 * (playerId, matchId) 복합 기본키 → 같은 경기를 여러 번 조회해도 중복 없이 멱등 적립된다.
 * Neople 매치 목록 API 는 최근 시즌(약 5개월)만 보관하므로, 조회 시점마다 적립해
 * 시간이 지나며 과거 시즌까지 이어붙이는 것이 이 테이블의 존재 이유다.
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";

/** 플레이어 개인 매치 히스토리 (연도별/플레이스타일 분석 원천) */
@Entity("player_matches", { comment: "플레이어 개인 매치 히스토리(개인 분석용 적립)" })
@Index(["playerId", "playedAt"])
export class PlayerMatch {
  /** 플레이어 ID (Neople playerId) — 복합 PK 1 */
  @PrimaryColumn({ comment: "플레이어 ID(Neople playerId)" })
  playerId: string;

  /** 매치 ID (Neople matchId) — 복합 PK 2, 중복 적립 방지 */
  @PrimaryColumn({ comment: "매치 ID(Neople matchId)" })
  matchId: string;

  /** 게임 타입 (rating=공식전 / normal=일반전) */
  @Column({ type: "varchar", nullable: true, comment: "게임 타입(rating/normal)" })
  gameTypeId: string | null;

  /** 경기 진행 시각 (연/월 버킷팅 기준) */
  @Column({ type: "timestamptz", nullable: true, comment: "경기 진행 시각" })
  playedAt: Date | null;

  /** 사용 캐릭터 ID */
  @Column({ comment: "사용 캐릭터 ID" })
  characterId: string;

  /** 사용 캐릭터명 (포지션 분류 조인 키) */
  @Column({ type: "varchar", nullable: true, comment: "사용 캐릭터명" })
  characterName: string | null;

  /** 경기 결과 (win/lose) */
  @Column({ type: "varchar", nullable: true, comment: "결과(win/lose)" })
  result: string | null;

  /** 맵 이름 (있을 때) */
  @Column({ type: "varchar", nullable: true, comment: "맵 이름" })
  mapName: string | null;

  /** 킬 수 */
  @Column({ type: "int", default: 0, comment: "킬" })
  killCount: number;

  /** 데스 수 */
  @Column({ type: "int", default: 0, comment: "데스" })
  deathCount: number;

  /** 어시스트 수 */
  @Column({ type: "int", default: 0, comment: "어시스트" })
  assistCount: number;

  /** 플레이 시간(초) */
  @Column({ type: "int", nullable: true, comment: "플레이 시간(초)" })
  playTime: number | null;

  /** 최종 레벨 */
  @Column({ type: "int", nullable: true, comment: "최종 레벨" })
  level: number | null;

  /** 성향 분석용 압축 스탯 (공격/피해/전투/시야/타워/힐 등) */
  @Column({ type: "jsonb", nullable: true, comment: "성향 분석용 압축 스탯(JSON)" })
  stats: unknown;

  /** 우리 DB에 적립된 시각 */
  @CreateDateColumn({ type: "timestamptz", comment: "적립 시각" })
  collectedAt: Date;
}
