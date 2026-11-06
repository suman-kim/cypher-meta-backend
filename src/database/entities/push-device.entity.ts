/**
 * push_devices 테이블 엔티티 — 푸시 알림을 받을 기기(앱 설치 1개 = 1행).
 *
 * 로그인이 없으므로 앱이 설치될 때 만든 무작위 installId(UUID v4)로 기기를 구분한다.
 * FCM 등록 토큰은 기기마다 하나이며 전체에서 유일하다(같은 토큰이 다른 installId 로 다시
 * 등록되면 옛 행을 지운다 — PushService.registerDevice 참고).
 * 운영 DB(DB_SYNC=false)는 sql/2026-11-06_push_tables.sql 로 테이블을 만든다. 이름·타입을 바꾸면 SQL도 함께 고칠 것.
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from "typeorm";

/** 푸시 알림을 받을 기기(앱 설치 단위) */
@Entity("push_devices", { comment: "푸시 알림을 받을 기기(앱 설치 1개당 1행)" })
export class PushDevice {
  /** 앱이 설치 시 만든 설치 ID(UUID v4) — 기본키. 로그인 대신 이 값으로 기기를 구분한다 */
  @PrimaryColumn("uuid", { primaryKeyConstraintName: "PK_push_devices", comment: "앱 설치 ID(UUID v4, 앱이 생성)" })
  installId: string;

  /** FCM 등록 토큰 — 이 기기로 알림을 보낼 주소. 전체에서 유일 */
  @Index("UQ_push_devices_token", { unique: true })
  @Column({ type: "varchar", length: 4096, comment: "FCM 등록 토큰(전체 유일)" })
  token: string;

  /** 기기 플랫폼 — "android" | "ios" */
  @Column({ type: "varchar", length: 16, comment: "기기 플랫폼(android/ios)" })
  platform: string;

  /** 최초 등록 시각 */
  @CreateDateColumn({ type: "timestamptz", comment: "최초 등록 시각" })
  createdAt: Date;

  /** 레코드 갱신 시각(토큰·플랫폼 변경 등) */
  @UpdateDateColumn({ type: "timestamptz", comment: "레코드 갱신 시각" })
  updatedAt: Date;

  /** 마지막으로 기기 등록·구독 동기화를 받은 시각(오래 안 쓰인 기기 정리 기준) */
  @Column({ type: "timestamptz", default: () => "now()", comment: "마지막 등록·구독 동기화 시각" })
  lastSeenAt: Date;
}
