/**
 * youtube.module.ts
 *
 * 유튜브 '사이퍼즈' 라이브 조회 모듈. NeopleModule 의 CacheService(TTL 캐시)를 재사용한다.
 * YoutubeService 는 푸시 알림 감지(방송 시작)에서도 쓰도록 export 한다.
 */
import { Module } from "@nestjs/common";
import { NeopleModule } from "../neople/neople.module";
import { YoutubeService } from "./youtube.service";
import { YoutubeController } from "./youtube.controller";

@Module({
  imports: [NeopleModule], // CacheService 재사용
  controllers: [YoutubeController],
  providers: [YoutubeService],
  exports: [YoutubeService], // 푸시 알림 감지(PushModule)에서 라이브 목록 재사용
})
export class YoutubeModule {}
