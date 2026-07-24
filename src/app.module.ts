/**
 * app.module.ts
 *
 * 애플리케이션 루트 모듈. 전역 설정(ConfigModule)과 데이터베이스 연결(TypeORM)을
 * 구성하고, 각 기능 모듈(Neople/Meta/Community/Analytics/Votes)을 조립한다.
 */
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule, TypeOrmModuleOptions } from "@nestjs/typeorm";
import { HealthController } from "./health.controller";
import { entities } from "./database/entities";
import { NeopleModule } from "./neople/neople.module";
import { MetaModule } from "./meta/meta.module";
import { CommunityModule } from "./community/community.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { VotesModule } from "./votes/votes.module";
import { CostumesModule } from "./costumes/costumes.module";

/** 전역 설정·DB 연결과 모든 기능 모듈을 묶는 애플리케이션 루트 모듈 */
@Module({
  imports: [
    // 환경변수 로딩 모듈(전역). ConfigService 로 어디서든 env 값에 접근 가능.
    ConfigModule.forRoot({
      isGlobal: true, // 전역 등록 — 각 모듈에서 별도 import 없이 ConfigService 사용
      // NODE_ENV 에 따라 .env.development / .env.production 을 로드.
      // (Vercel은 NODE_ENV=production → .env.production 파일이 없으므로 대시보드 env 사용)
      envFilePath: `.env.${process.env.NODE_ENV ?? "development"}`,
    }),
    // TypeORM 데이터베이스 연결(비동기 팩토리 — ConfigService 값으로 옵션을 생성).
    TypeOrmModule.forRootAsync({
      inject: [ConfigService], // 팩토리에 ConfigService 주입
      useFactory: (c: ConfigService): TypeOrmModuleOptions => {
        // DATABASE_URL(Neon/Vercel) 우선, 없으면 개별 변수(로컬)로 폴백.
        const url = c.get<string>("DATABASE_URL");
        // Neon 등 서버리스 Postgres는 SSL 필요. URL이 있으면 기본 SSL on.
        const useSsl = c.get<string>("DB_SSL", url ? "true" : "false") !== "false";
        // 연결 방식(URL/개별 변수)이 공유하는 공통 옵션.
        const common = {
          type: "postgres" as const, // DB 종류: PostgreSQL
          entities, // 등록할 엔티티 목록
          synchronize: c.get<string>("DB_SYNC", "false") === "true", // 스키마 자동 동기화 여부(기본 false)
          ssl: useSsl ? { rejectUnauthorized: false } : false, // SSL 사용 시 인증서 검증 완화
          // 서버리스 환경 커넥션 제한 — Neon 풀러(-pooler) 연결 문자열 권장.
          extra: { max: Number(c.get("DB_POOL_MAX", "5")) || 5 }, // 커넥션 풀 최대 수(기본 5)
        };
        if (url) return { ...common, url }; // DATABASE_URL 이 있으면 URL 방식으로 연결
        // URL 이 없을 때: 개별 접속 정보(주로 로컬 개발)로 연결.
        return {
          ...common,
          host: c.get<string>("DB_HOST", "localhost"), // DB 호스트(기본 localhost)
          port: Number(c.get("DB_PORT", "5432")), // DB 포트(기본 5432)
          username: c.get<string>("DB_USERNAME", "postgres"), // DB 사용자(기본 postgres)
          password: c.get<string>("DB_PASSWORD", "postgres"), // DB 비밀번호(기본 postgres)
          database: c.get<string>("DB_NAME", "cyphers"), // DB 이름(기본 cyphers)
        };
      },
    }),
    NeopleModule, // Neople API 프록시·캐시 기능
    MetaModule, // 메타(통계/랭킹 등) 기능
    CommunityModule, // 커뮤니티 기능
    AnalyticsModule, // 방문/이벤트 트래킹·통계 기능
    VotesModule, // 투표 기능
    CostumesModule, // 코스튬(치장) 카탈로그 기능
  ],
  controllers: [HealthController], // 루트/헬스체크 엔드포인트
})
export class AppModule {}
