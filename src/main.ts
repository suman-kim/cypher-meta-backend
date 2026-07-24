/**
 * main.ts
 *
 * 애플리케이션 진입점(부트스트랩). Nest 앱을 생성하고 CORS·전역 prefix·
 * 전역 유효성 검사 파이프를 설정한 뒤 지정 포트로 서버를 기동한다.
 */
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module";

/**
 * Nest 애플리케이션을 초기화하고 HTTP 서버를 시작한다.
 * - CORS 허용 오리진(CORS_ORIGIN, 콤마 구분) 설정, 미지정 시 전체("*") 허용
 * - 전역 경로 prefix "api" 적용
 * - 전역 ValidationPipe(whitelist·transform) 적용
 * - PORT(기본 4000)로 리슨
 *
 * @returns 없음(서버 기동 완료 시 resolve)
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  const origins = config.get<string>("CORS_ORIGIN");
  app.enableCors({ origin: origins ? origins.split(",") : "*", credentials: true });
  app.setGlobalPrefix("api");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = Number(config.get("PORT") ?? 4000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`🟦 Cyphers API listening on http://localhost:${port}/api`);
}
bootstrap();
