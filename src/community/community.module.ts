import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Comment, Post } from "../database/entities";
import { CommunityController } from "./community.controller";
import { CommunityService } from "./community.service";

@Module({
  imports: [TypeOrmModule.forFeature([Post, Comment])],
  controllers: [CommunityController],
  providers: [CommunityService],
})
export class CommunityModule {}
