/**
 * cf-throttler.guard.ts
 *
 * Cloudflare 프록시 뒤에서 동작하는 rate-limit(요청 속도 제한) 가드.
 * 기본 ThrottlerGuard 는 req.ip 로 클라이언트를 식별하는데, Cloudflare 뒤에서는
 * 그 값이 Cloudflare 엣지 IP 라 모든 사용자가 하나로 묶여 제한이 무의미해진다.
 * 실제 클라이언트 IP 인 `cf-connecting-ip` 헤더를 우선 사용해 IP별로 제한한다.
 * (Cloudflare 미경유 요청은 x-forwarded-for → req.ip 순으로 폴백)
 */
import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

@Injectable()
export class CfThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const headers = (req && req.headers) || {};
    const cf = headers["cf-connecting-ip"];
    if (typeof cf === "string" && cf.trim()) return cf.trim();

    const xff = headers["x-forwarded-for"];
    const first = Array.isArray(xff)
      ? xff[0]
      : typeof xff === "string"
        ? xff.split(",")[0]
        : undefined;
    if (first && first.trim()) return first.trim();

    return (req && req.ip) || "unknown";
  }
}
