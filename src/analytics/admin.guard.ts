import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";

/** x-admin-token 헤더를 ADMIN_TOKEN 환경변수와 비교하는 간단한 관리자 가드 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers["x-admin-token"];
    const token = Array.isArray(header) ? header[0] : header;
    const expected = process.env.ADMIN_TOKEN;

    if (!expected) {
      throw new UnauthorizedException("서버에 ADMIN_TOKEN 이 설정되지 않았습니다.");
    }
    if (!token || token !== expected) {
      throw new UnauthorizedException("관리자 인증에 실패했습니다.");
    }
    return true;
  }
}
