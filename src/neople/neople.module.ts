/**
 * neople.module.ts
 *
 * Neople 오픈 API 프록시 기능을 구성하는 NestJS 모듈.
 * ApiCache 엔티티 리포지토리를 등록하고, 캐시·프록시 서비스와 컨트롤러를 묶는다.
 * NeopleService·CacheService 를 export 하여 다른 모듈에서도 재사용할 수 있게 한다.
 */
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ApiCache } from "../database/entities";
import { CacheService } from "./cache.service";
import { NeopleService } from "./neople.service";
import { NeopleController } from "./neople.controller";

/** Neople API 프록시·캐시 관련 컨트롤러·서비스·엔티티를 묶는 모듈 */
@Module({
  imports: [TypeOrmModule.forFeature([ApiCache])], // ApiCache(캐시) 엔티티 리포지토리 주입 등록
  controllers: [NeopleController], // /api/cy/* 프록시 라우트 처리
  providers: [CacheService, NeopleService], // TTL 캐시 + Neople 프록시 서비스
  exports: [NeopleService, CacheService], // 다른 모듈에서 재사용 가능하도록 공개
})
export class NeopleModule {}
