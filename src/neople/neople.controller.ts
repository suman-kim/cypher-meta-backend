/**
 * neople.controller.ts
 *
 * /api/cy/* 로 들어오는 모든 요청을 Neople 오픈 API로 중계(프록시)하는 컨트롤러.
 * 요청 경로에서 /api/cy 접두사를 떼어낸 하위 경로를 서비스에 넘겨 처리한다.
 */
import { Controller, Get, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
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
  async proxy(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const full = req.originalUrl || req.url; // "/api/cy/players?nickname=..."
    const rawSub = full.replace(/^\/api\/cy/, "") || "/";
    // nocache/refresh 플래그가 있으면 캐시를 우회한다. 단 이 플래그는 캐시키·Neople 요청을
    // 오염시키지 않도록 subPath 에서 제거하고, fresh 옵션으로만 전달한다.
    const [path, qs] = rawSub.split("?");
    let fresh = false;
    let cleanQs = "";
    if (qs) {
      const params = new URLSearchParams(qs);
      fresh = params.has("nocache") || params.has("refresh");
      params.delete("nocache");
      params.delete("refresh");
      cleanQs = params.toString();
    }
    const sub = cleanQs ? `${path}?${cleanQs}` : path;
    const body = await this.neople.proxy(sub, { fresh });
    // 이 데이터가 마지막으로 원본에서 받아진(갱신된) 시각을 헤더로 함께 내려준다.
    const cachedAt = await this.neople.cachedAt(sub);
    if (cachedAt) res.setHeader("X-Data-Cached-At", cachedAt);
    return body;
  }
}
