import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { HealthController } from "./health.controller";
import { entities } from "./database/entities";
import { NeopleModule } from "./neople/neople.module";
import { MetaModule } from "./meta/meta.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        type: "postgres",
        host: c.get<string>("DB_HOST", "localhost"),
        port: Number(c.get("DB_PORT", "5432")),
        username: c.get<string>("DB_USERNAME", "postgres"),
        password: c.get<string>("DB_PASSWORD", "postgres"),
        database: c.get<string>("DB_NAME", "cyphers"),
        entities,
        synchronize: c.get<string>("DB_SYNC", "false") === "true",
      }),
    }),
    NeopleModule,
    MetaModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
