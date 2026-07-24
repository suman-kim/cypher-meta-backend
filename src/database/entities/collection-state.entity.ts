/**
 * collection_state 테이블 엔티티 — 메타 수집 파이프라인의 진행 상태를 key-value 로 저장.
 * (예: 로테이션 수집 커서 위치, 마지막 실행 정보 등)
 */
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

/** 수집 파이프라인 진행 상태 (커서/타임스탬프 등) */
@Entity("collection_state", { comment: "메타 수집 파이프라인 진행 상태(key-value)" })
export class CollectionState {
  /** 상태 키 (예: meta_cron_cursor, meta_collect). 기본키. */
  @PrimaryColumn({ comment: "상태 키(예: meta_cron_cursor, meta_collect)" })
  key: string;

  /** 상태 값(JSON) — 커서 인덱스·마지막 실행 정보 등. 없을 수 있음 */
  @Column({ type: "jsonb", nullable: true, comment: "상태 값(JSON): 커서/실행정보 등" })
  value: unknown;

  /** 상태 마지막 갱신 시각 */
  @UpdateDateColumn({ type: "timestamptz", comment: "마지막 갱신 시각" })
  updatedAt: Date;
}
