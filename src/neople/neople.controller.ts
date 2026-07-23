import { Controller, Get, Req } from "@nestjs/common";
import type { Request } from "express";
import { NeopleService } from "./neople.service";

/** /api/cy/* 로 오는 모든 요청을 Neople API로 프록시(+캐싱) */
@Controller("cy")
export class NeopleController {
  constructor(private readonly neople: NeopleService) {}

  @Get("*")
  proxy(@Req() req: Request) {
    const full = req.originalUrl || req.url; // "/api/cy/players?nickname=..."
    const sub = full.replace(/^\/api\/cy/, "") || "/";
    return this.neople.proxy(sub);
  }
}
