import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/** 방문/이벤트 로그 (익명 방문자 트래킹) */
@Entity("visits")
export class Visit {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** 익명 방문자 식별자(쿠키) — 순 방문자 집계용 */
  @Index()
  @Column({ type: "varchar" })
  visitorId: string;

  /** pageview | search | ... */
  @Index()
  @Column({ default: "pageview" })
  event: string;

  @Index()
  @Column({ type: "varchar", length: 512 })
  path: string;

  @Column({ type: "varchar", length: 1024, nullable: true })
  referrer: string | null;

  /** 검색어 등 이벤트 부가값 */
  @Column({ type: "varchar", length: 190, nullable: true })
  query: string | null;

  @Column({ type: "varchar", length: 64, nullable: true })
  ip: string | null;

  @Index()
  @Column({ type: "varchar", length: 8, nullable: true })
  country: string | null;

  @Column({ type: "varchar", length: 128, nullable: true })
  city: string | null;

  @Column({ type: "varchar", length: 32, nullable: true })
  browser: string | null;

  @Column({ type: "varchar", length: 32, nullable: true })
  os: string | null;

  /** desktop | mobile | tablet | bot */
  @Index()
  @Column({ type: "varchar", length: 16, nullable: true })
  device: string | null;

  @Column({ type: "text", nullable: true })
  userAgent: string | null;

  @Index()
  @CreateDateColumn({ type: "timestamptz" })
  createdAt: Date;
}
