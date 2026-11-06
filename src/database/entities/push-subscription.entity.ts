/**
 * push_subscriptions 테이블 엔티티 — 기기별 알림 구독 대상(기기 1대 × 대상 1개 = 1행).
 *
 *  - kind="player" : 전적 갱신 알림. targetId = Neople playerId(32자리 16진수)
 *  - kind="live"   : 방송 시작 알림. targetId = `${platform}:${channelId}` (platform = chzzk | youtube | soop)
 *
 * (installId, kind, targetId) 는 유일하다. 앱은 구독 목록 전체를 보내고, 서버는 차이(diff)만 반영해
 * 이미 있던 행은 그대로 둔다 — 그래야 전적 알림의 기준점(lastEventAt)이 동기화 때마다 지워지지 않는다.
 * 기기(push_devices)가 지워지면 외래키(ON DELETE CASCADE)로 함께 지워진다.
 * 운영 DB(DB_SYNC=false)는 sql/2026-11-06_push_tables.sql 로 테이블을 만든다. 이름·타입을 바꾸면 SQL도 함께 고칠 것.
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { PushDevice } from "./push-device.entity";

/** 구독 종류 목록 — player(전적 갱신) / live(방송 시작) */
export const PUSH_SUBSCRIPTION_KINDS = ["player", "live"] as const;
/** 구독 종류 */
export type PushSubscriptionKind = (typeof PUSH_SUBSCRIPTION_KINDS)[number];

/** 기기별 알림 구독 대상 */
@Entity("push_subscriptions", { comment: "기기별 푸시 알림 구독 대상(전적 갱신·방송 시작)" })
@Index("UQ_push_subscriptions_target", ["installId", "kind", "targetId"], { unique: true })
@Index("IDX_push_subscriptions_kind_target", ["kind", "targetId"])
export class PushSubscription {
  /** 구독 행 ID(UUID 자동 생성) — 기본키 */
  @PrimaryGeneratedColumn("uuid", { primaryKeyConstraintName: "PK_push_subscriptions", comment: "구독 행 ID(UUID)" })
  id: string;

  /**
   * 구독한 기기의 설치 ID(push_devices.installId).
   * 이 컬럼으로 시작하는 유일 인덱스(UQ_push_subscriptions_target)가 기기별 조회 인덱스 역할도 한다.
   */
  @Column("uuid", { comment: "구독한 기기 설치 ID(push_devices.installId)" })
  installId: string;

  /** 구독한 기기(외래키 — 기기가 지워지면 구독도 함께 지워짐). 조회 시 기본으로 불러오지 않는다 */
  @ManyToOne(() => PushDevice, { onDelete: "CASCADE" })
  @JoinColumn({
    name: "installId",
    referencedColumnName: "installId",
    foreignKeyConstraintName: "FK_push_subscriptions_installId",
  })
  device?: PushDevice;

  /** 구독 종류 — "player"(전적 갱신) | "live"(방송 시작) */
  @Column({ type: "varchar", length: 16, comment: "구독 종류(player=전적 갱신 / live=방송 시작)" })
  kind: string;

  /** 구독 대상 ID — player: Neople playerId / live: "플랫폼:채널ID" */
  @Column({ type: "varchar", length: 160, comment: "구독 대상 ID(player: playerId / live: 플랫폼:채널ID)" })
  targetId: string;

  /** 구독할 때의 표시명 스냅샷(플레이어 닉네임 또는 채널명). 알림 문구의 예비 이름으로 쓴다 */
  @Column({ type: "varchar", length: 100, nullable: true, comment: "표시명 스냅샷(닉네임/채널명)" })
  label: string | null;

  /**
   * (player 전용) 이 구독에 마지막으로 반영한 경기 시각. 이 시각보다 뒤의 경기만 '새 경기'로 알린다.
   * null 이면 아직 기준점이 없다는 뜻 — 첫 점검 때 가장 최근 경기 시각으로 채우고 알리지 않는다.
   */
  @Column({ type: "timestamptz", nullable: true, comment: "(player 전용) 마지막으로 반영한 경기 시각, null=기준점 없음" })
  lastEventAt: Date | null;

  /** 구독 등록 시각 */
  @CreateDateColumn({ type: "timestamptz", comment: "구독 등록 시각" })
  createdAt: Date;
}
