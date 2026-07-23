import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Match, MatchPlayer, CollectionState } from "../database/entities";
import { NeopleModule } from "../neople/neople.module";
import { MetaService } from "./meta.service";
import { CollectorService } from "./collector.service";
import { MetaController } from "./meta.controller";

@Module({
  imports: [TypeOrmModule.forFeature([Match, MatchPlayer, CollectionState]), NeopleModule],
  controllers: [MetaController],
  providers: [MetaService, CollectorService],
})
export class MetaModule {}
