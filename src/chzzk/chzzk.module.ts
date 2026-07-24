/**
 * chzzk.module.ts
 *
 * 치지직(CHZZK) 라이브 조회 기능 모듈.
 * NeopleModule 을 import 하여 CacheService(api_cache TTL 캐시)를 재사용한다.
 */
import { Module } from "@nestjs/common";
import { NeopleModule } from "../neople/neople.module";
import { ChzzkService } from "./chzzk.service";
import { ChzzkController } from "./chzzk.controller";

/** 치지직 라이브 조회 컨트롤러·서비스를 묶는 모듈 */
@Module({
  imports: [NeopleModule], // CacheService 재사용(ApiCache 리포지토리 포함)
  controllers: [ChzzkController], // GET /api/chzzk/lives
  providers: [ChzzkService], // 조회·정규화·캐싱 서비스
})
export class ChzzkModule {}
