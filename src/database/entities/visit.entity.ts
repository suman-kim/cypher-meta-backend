/**
 * visits 테이블 엔티티 — 방문/이벤트 로그(익명 방문자 트래킹).
 * pageview·search 등 이벤트, 경로, 유입, 지역(GeoIP), 브라우저/OS/기기를 기록해
 * 방문 통계·순 방문자(UV) 집계에 사용한다.
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/** 방문/이벤트 로그 (익명 방문자 트래킹) */
@Entity("visits", { comment: "방문/이벤트 로그(익명 트래킹)" })
export class Visit {
  /** 로그 고유 ID (UUID 자동 생성, 기본키) */
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** 익명 방문자 식별자(쿠키) — 순 방문자(UV) 집계용 */
  @Index()
  @Column({ type: "varchar", comment: "익명 방문자 식별자(쿠키, UV 집계)" })
  visitorId: string;

  /** 이벤트 종류: pageview | search | ... */
  @Index()
  @Column({ default: "pageview", comment: "이벤트 종류(pageview/search 등)" })
  event: string;

  /** 방문 경로(URL path) */
  @Index()
  @Column({ type: "varchar", length: 512, comment: "방문 경로(path)" })
  path: string;

  /** 유입 경로(referrer) */
  @Column({ type: "varchar", length: 1024, nullable: true, comment: "유입 경로(referrer)" })
  referrer: string | null;

  /** 이벤트 부가값(예: 검색어) */
  @Column({ type: "varchar", length: 190, nullable: true, comment: "이벤트 부가값(검색어 등)" })
  query: string | null;

  /** 방문자 IP */
  @Column({ type: "varchar", length: 64, nullable: true, comment: "방문자 IP" })
  ip: string | null;

  /** 국가 코드(GeoIP) */
  @Index()
  @Column({ type: "varchar", length: 8, nullable: true, comment: "국가 코드(GeoIP)" })
  country: string | null;

  /** 도시(GeoIP) */
  @Column({ type: "varchar", length: 128, nullable: true, comment: "도시(GeoIP)" })
  city: string | null;

  /** 브라우저명 */
  @Column({ type: "varchar", length: 32, nullable: true, comment: "브라우저명" })
  browser: string | null;

  /** 운영체제(OS) */
  @Column({ type: "varchar", length: 32, nullable: true, comment: "OS" })
  os: string | null;

  /** 기기 유형: desktop | mobile | tablet | bot */
  @Index()
  @Column({ type: "varchar", length: 16, nullable: true, comment: "기기 유형(desktop/mobile/tablet/bot)" })
  device: string | null;

  /** 원본 User-Agent 문자열 */
  @Column({ type: "text", nullable: true, comment: "원본 User-Agent" })
  userAgent: string | null;

  /** 방문 시각 */
  @Index()
  @CreateDateColumn({ type: "timestamptz", comment: "방문 시각" })
  createdAt: Date;
}
