/**
 * users 테이블 엔티티 — 서비스 계정(회원).
 * (로그인 기능은 추후 도입 예정이며, 현재는 스키마만 준비된 상태)
 */
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/** 서비스 계정 */
@Entity("users", { comment: "서비스 계정(회원)" })
export class User {
  /** 회원 고유 ID (UUID 자동 생성, 기본키) */
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** 이메일 (로그인 아이디, 유니크) */
  @Column({ unique: true, comment: "이메일(로그인 아이디, 유니크)" })
  email: string;

  /** 비밀번호 해시. select:false 라 기본 조회에서 제외됨 */
  @Column({ select: false, comment: "비밀번호 해시(기본 조회 제외)" })
  passwordHash: string;

  /** 표시 닉네임 (유니크) */
  @Column({ unique: true, comment: "닉네임(유니크)" })
  nickname: string;

  /** 권한 역할 (user=일반 / admin=관리자 등). 기본값 user */
  @Column({ default: "user", comment: "권한 역할(user/admin 등)" })
  role: string;

  /** 계정 생성 시각 */
  @CreateDateColumn({ type: "timestamptz", comment: "가입 시각" })
  createdAt: Date;

  /** 계정 정보 마지막 수정 시각 */
  @UpdateDateColumn({ type: "timestamptz", comment: "마지막 수정 시각" })
  updatedAt: Date;
}
