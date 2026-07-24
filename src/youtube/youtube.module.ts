/**
 * youtube.module.ts
 *
 * 유튜브 '사이퍼즈' 라이브 조회 모듈. NeopleModule 의 CacheService(TTL 캐시)를 재사용한다.
 */
import { Module } from "@nestjs/common";
import { NeopleModule } from "../neople/neople.module";
import { YoutubeService } from "./youtube.service";
import { YoutubeController } from "./youtube.controller";

@Module({
  imports: [NeopleModule], // CacheService 재사용
  controllers: [YoutubeController],
  providers: [YoutubeService],
})
export class YoutubeModule {}
