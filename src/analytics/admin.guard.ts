/**
 * admin.guard.ts
 *
 * 관리자 전용 엔드포인트를 보호하는 NestJS 가드를 정의하는 파일.
 * 요청 헤더의 x-admin-token 값을 서버의 ADMIN_TOKEN 환경변수와 비교하여
 * 일치할 때만 요청을 통과시킨다. (analytics 관리자 API 등에서 사용)
 */
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";

/** x-admin-token 헤더를 ADMIN_TOKEN 환경변수와 비교하는 간단한 관리자 가드 */
@Injectable()
export class AdminGuard implements CanActivate {
  /**
   * 요청이 관리자 권한을 가지는지 검사한다.
   * 요청 헤더의 x-admin-token 이 서버의 ADMIN_TOKEN 환경변수와 정확히 일치해야 통과한다.
   *
   * @param ctx — 현재 요청 실행 컨텍스트(HTTP 요청 객체를 꺼내는 데 사용)
   * @returns 인증 성공 시 true. 실패 시 UnauthorizedException 을 던진다
   *          (ADMIN_TOKEN 미설정 또는 토큰 불일치 시 예외 발생).
   */
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
