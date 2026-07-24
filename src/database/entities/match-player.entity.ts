/**
 * match_players 테이블 엔티티 — 한 매치 안에서 플레이어별 기록.
 * 픽률·승률·아이템 채택률 등 메타 집계의 원천 데이터가 된다.
 * (matchId·characterId·playerId 인덱스로 집계 쿼리 성능 확보)
 */
import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/** 매치 내 플레이어별 기록 (픽률·승률·아이템 채택률 집계의 원천) */
@Entity("match_players", { comment: "매치 내 플레이어별 기록(메타 집계 원천)" })
@Index(["matchId"])
@Index(["characterId"])
@Index(["playerId"])
export class MatchPlayer {
  /** 행 고유 ID (UUID 자동 생성, 기본키) */
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** 소속 매치 ID (matches.matchId) */
  @Column({ comment: "소속 매치 ID(matches.matchId)" })
  matchId: string;

  /** 플레이어 ID (Neople playerId) */
  @Column({ comment: "플레이어 ID(Neople playerId)" })
  playerId: string;

  /** 닉네임 (수집 시점 스냅샷) */
  @Column({ type: "varchar", nullable: true, comment: "닉네임(스냅샷)" })
  nickname: string | null;

  /** 사용 캐릭터 ID */
  @Column({ comment: "사용 캐릭터 ID" })
  characterId: string;

  /** 사용 캐릭터명 */
  @Column({ type: "varchar", nullable: true, comment: "사용 캐릭터명" })
  characterName: string | null;

  /** win / lose */
  @Column({ comment: "결과(win/lose)" })
  result: string;

  /** 게임 타입 (rating/normal 등) */
  @Column({ type: "varchar", nullable: true, comment: "게임 타입(rating/normal)" })
  gameTypeId: string | null;

  /** 킬 수 */
  @Column({ type: "int", default: 0, comment: "킬 수" })
  killCount: number;

  /** 데스 수 */
  @Column({ type: "int", default: 0, comment: "데스 수" })
  deathCount: number;

  /** 어시스트 수 */
  @Column({ type: "int", default: 0, comment: "어시스트 수" })
  assistCount: number;

  /** 최종 장착 아이템 (집계용, JSON 배열) */
  @Column({ type: "jsonb", nullable: true, comment: "최종 장착 아이템(JSON, 집계용)" })
  items: any;
}
