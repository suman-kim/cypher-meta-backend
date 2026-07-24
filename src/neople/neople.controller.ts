/**
 * neople.controller.ts
 *
 * /api/cy/* 로 들어오는 모든 요청을 Neople 오픈 API로 중계(프록시)하는 컨트롤러.
 * 요청 경로에서 /api/cy 접두사를 떼어낸 하위 경로를 서비스에 넘겨 처리한다.
 */
import { Controller, Get, Req } from "@nestjs/common";
import type { Request } from "express";
import { NeopleService } from "./neople.service";

/** /api/cy/* 로 오는 모든 요청을 Neople API로 프록시(+캐싱) */
@Controller("cy")
export class NeopleController {
  /**
   * @param neople — Neople API 프록시·캐싱을 수행하는 서비스(의존성 주입)
   */
  constructor(private readonly neople: NeopleService) {}

  /**
   * /api/cy 이하 모든 GET 요청을 받아 Neople API로 프록시한다.
   * 원본 URL에서 "/api/cy" 접두사를 제거한 하위 경로를 서비스로 전달한다.
   *
   * HTTP: GET /api/cy/*  (와일드카드 — 예: /api/cy/players?nickname=...)
   * @param req — Express 요청 객체(원본 URL에서 하위 경로 추출에 사용)
   * @returns Neople API 응답(JSON). 캐시 히트 시 캐시된 값.
   */
  @Get("*")
  proxy(@Req() req: Request) {
    const full = req.originalUrl || req.url; // "/api/cy/players?nickname=..."
    const sub = full.replace(/^\/api\/cy/, "") || "/";
    return this.neople.proxy(sub);
  }
}
