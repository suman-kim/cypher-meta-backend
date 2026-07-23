import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ApiCache } from "../database/entities";
import { CacheService } from "./cache.service";
import { NeopleService } from "./neople.service";
import { NeopleController } from "./neople.controller";

@Module({
  imports: [TypeOrmModule.forFeature([ApiCache])],
  controllers: [NeopleController],
  providers: [CacheService, NeopleService],
  exports: [NeopleService, CacheService],
})
export class NeopleModule {}
