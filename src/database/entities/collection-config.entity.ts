/**
 * collection_config 테이블 엔티티 — 메타 수집 "설정" 단일 행.
 * 기존에 env(META_*) 로만 조절하던 값들을 DB 로 옮겨, 재배포 없이 런타임에 변경 가능하게 한다.
 * 최초 부팅 시 env 값으로 1회 시딩되며, 이후에는 이 테이블이 진실원본(source of truth)이다.
 */
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

/** 메타 수집 설정(단일 행). id="default" 한 행만 사용한다. */
@Entity("collection_config", { comment: "메타 수집 설정(env 대체, DB에서 편집)" })
export class CollectionConfig {
  /** 설정 프로필 키. 기본 "default" 한 행만 운영한다. */
  @PrimaryColumn({ type: "varchar", default: "default", comment: "설정 프로필 키(기본 default)" })
  id: string;

  /** 자동 수집 on/off (env META_AUTO_COLLECT). */
  @Column({ type: "boolean", default: true, comment: "자동 수집 on/off" })
  autoCollect: boolean;

  /** 자동 수집 주기(시간) (env META_COLLECT_INTERVAL_HOURS). */
  @Column({ type: "real", default: 6, comment: "자동 수집 주기(시간)" })
  intervalHours: number;

  /** 수집 방식: rotating(회전, 상위 maxRank 를 window 단위로 순회) | fixed(항상 상위 rankers). */
  @Column({ type: "varchar", default: "rotating", comment: "수집 방식: rotating|fixed" })
  mode: string;

  /** fixed 모드에서 매 실행 수집할 상위 랭커 수(=랭킹 조회 limit) (env META_COLLECT_RANKERS). */
  @Column({ type: "int", default: 20, comment: "fixed 모드 상위 랭커 수" })
  rankers: number;

  /** 플레이어당 조회할 최근 매치 수 (env META_COLLECT_PER_PLAYER). */
  @Column({ type: "int", default: 10, comment: "플레이어당 조회 매치 수" })
  perPlayer: number;

  /** 게임 타입. rating=공식전 (env META_COLLECT_GAME_TYPE). */
  @Column({ type: "varchar", default: "rating", comment: "게임 타입(rating=공식전)" })
  gameType: string;

  /** rotating 모드에서 1회 실행당 수집 인원(window) (env META_CRON_WINDOW). */
  @Column({ type: "int", default: 10, comment: "rotating 1회 수집 인원(window)" })
  cronWindow: number;

  /** rotating 모드 순회 상한 순위(maxRank) (env META_CRON_MAX_RANK). */
  @Column({ type: "int", default: 500, comment: "rotating 순회 상한 순위(maxRank)" })
  maxRank: number;

  /** rotating 커서: 다음에 수집할 시작 오프셋(0=1위). "어디까지 수집했는지"의 기준점. */
  @Column({ type: "int", default: 0, comment: "rotating 커서(다음 시작 오프셋, 0=1위)" })
  cursorOffset: number;

  /** 설정 마지막 수정 시각. */
  @UpdateDateColumn({ type: "timestamptz", comment: "설정 마지막 수정 시각" })
  updatedAt: Date;
}
