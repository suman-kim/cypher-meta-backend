import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule, TypeOrmModuleOptions } from "@nestjs/typeorm";
import { HealthController } from "./health.controller";
import { entities } from "./database/entities";
import { NeopleModule } from "./neople/neople.module";
import { MetaModule } from "./meta/meta.module";
import { CommunityModule } from "./community/community.module";
import { AnalyticsModule } from "./analytics/analytics.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // NODE_ENV 에 따라 .env.development / .env.production 을 로드.
      // (Vercel은 NODE_ENV=production → .env.production 파일이 없으므로 대시보드 env 사용)
      envFilePath: `.env.${process.env.NODE_ENV ?? "development"}`,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService): TypeOrmModuleOptions => {
        // DATABASE_URL(Neon/Vercel) 우선, 없으면 개별 변수(로컬)로 폴백.
        const url = c.get<string>("DATABASE_URL");
        // Neon 등 서버리스 Postgres는 SSL 필요. URL이 있으면 기본 SSL on.
        const useSsl = c.get<string>("DB_SSL", url ? "true" : "false") !== "false";
        const common = {
          type: "postgres" as const,
          entities,
          synchronize: c.get<string>("DB_SYNC", "false") === "true",
          ssl: useSsl ? { rejectUnauthorized: false } : false,
          // 서버리스 환경 커넥션 제한 — Neon 풀러(-pooler) 연결 문자열 권장.
          extra: { max: Number(c.get("DB_POOL_MAX", "5")) || 5 },
        };
        if (url) return { ...common, url };
        return {
          ...common,
          host: c.get<string>("DB_HOST", "localhost"),
          port: Number(c.get("DB_PORT", "5432")),
          username: c.get<string>("DB_USERNAME", "postgres"),
          password: c.get<string>("DB_PASSWORD", "postgres"),
          database: c.get<string>("DB_NAME", "cyphers"),
        };
      },
    }),
    NeopleModule,
    MetaModule,
    CommunityModule,
    AnalyticsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
