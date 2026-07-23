import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module";

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
