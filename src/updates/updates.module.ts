/**
 * updates.module.ts — 업데이트 노트(패치노트) 기능 모듈.
 * UpdateNote 엔티티를 TypeOrmModule.forFeature 로 등록하여
 * 컨트롤러/서비스에 리포지토리를 주입할 수 있게 묶는다.
 */
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UpdateComment, UpdateNote } from "../database/entities";
import { UpdatesController } from "./updates.controller";
import { UpdatesService } from "./updates.service";

/** 업데이트 노트 모듈. UpdateNote/UpdateComment 리포지토리를 제공하고 컨트롤러·서비스를 등록한다. */
@Module({
  imports: [TypeOrmModule.forFeature([UpdateNote, UpdateComment])],
  controllers: [UpdatesController],
  providers: [UpdatesService],
})
export class UpdatesModule {}
