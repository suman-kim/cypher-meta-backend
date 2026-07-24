/**
 * collection_run 테이블 엔티티 — 메타 수집 "실행 이력/결과".
 * 매 수집 실행마다 1행이 기록된다. 트리거(자동/수동), 커버한 랭커 범위,
 * 수집 결과 카운트, 성공/실패 상태를 남겨 "언제·어떤 범위까지·어떻게 수집됐는지" 추적한다.
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/** 메타 수집 실행 1건의 기록(이력). */
@Entity("collection_run", { comment: "메타 수집 실행 이력/결과" })
@Index(["startedAt"])
export class CollectionRun {
  /** 자동 증가 PK(bigint → JS string). */
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id: string;

  /** 트리거 종류: auto(자동) | manual(수동). */
  @Column({ type: "varchar", comment: "트리거: auto|manual" })
  trigger: string;

  /** 세부 출처: interval(주기 스케줄러) | cron(Vercel Cron) | api(수동 API) | boot(부팅 최초). */
  @Column({ type: "varchar", comment: "출처: interval|cron|api|boot" })
  source: string;

  /** 수집 방식: rotating | fixed. */
  @Column({ type: "varchar", comment: "수집 방식: rotating|fixed" })
  mode: string;

  /** 게임 타입. */
  @Column({ type: "varchar", comment: "게임 타입" })
  gameType: string;

  /** 이번 실행이 커버한 랭커 범위 시작(1-based, = offset+1). */
  @Column({ type: "int", comment: "커버 랭커 범위 시작(1-based)" })
  rankFrom: number;

  /** 이번 실행이 커버한 랭커 범위 끝(1-based). */
  @Column({ type: "int", comment: "커버 랭커 범위 끝(1-based)" })
  rankTo: number;

  /** 사용한 랭킹 조회 오프셋(0-based). */
  @Column({ type: "int", comment: "랭킹 오프셋(0-based)" })
  offset: number;

  /** 수집 인원(window/rankers). */
  @Column({ type: "int", comment: "수집 인원(window/rankers)" })
  windowSize: number;

  /** 플레이어당 조회 매치 수. */
  @Column({ type: "int", comment: "플레이어당 조회 매치 수" })
  perPlayer: number;

  /** 훑은(스캔한) 매치 수. */
  @Column({ type: "int", default: 0, comment: "스캔한 매치 수" })
  scanned: number;

  /** 신규 저장한 매치 수. */
  @Column({ type: "int", default: 0, comment: "신규 저장 매치 수" })
  collected: number;

  /** 저장된 플레이어 기록(행) 수. */
  @Column({ type: "int", default: 0, comment: "저장 플레이어 기록 수" })
  playerRows: number;

  /** 실행 상태: running | success | failed | skipped(이미 실행 중 등). */
  @Column({ type: "varchar", default: "running", comment: "상태: running|success|failed|skipped" })
  status: string;

  /** 실패/스킵 사유(있으면). */
  @Column({ type: "text", nullable: true, comment: "실패/스킵 사유" })
  error: string | null;

  /** 시작 시각. */
  @CreateDateColumn({ type: "timestamptz", comment: "시작 시각" })
  startedAt: Date;

  /** 종료 시각(완료 시 기록). */
  @Column({ type: "timestamptz", nullable: true, comment: "종료 시각" })
  finishedAt: Date | null;

  /** 소요 시간(ms). */
  @Column({ type: "int", nullable: true, comment: "소요 시간(ms)" })
  durationMs: number | null;
}
