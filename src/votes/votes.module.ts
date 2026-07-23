import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Vote } from "../database/entities";
import { VotesService } from "./votes.service";
import { VotesController } from "./votes.controller";

@Module({
  imports: [TypeOrmModule.forFeature([Vote])],
  controllers: [VotesController],
  providers: [VotesService],
})
export class VotesModule {}
