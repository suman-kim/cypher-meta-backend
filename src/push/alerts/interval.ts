/**
 * interval.ts
 *
 * 감지 작업의 실행 간격(초)을 env 에서 읽는 작은 도우미.
 */
import { ConfigService } from "@nestjs/config";

/**
 * 숫자 env 를 읽는다. 없거나 숫자가 아니거나 최소값보다 작으면 기본값을 쓴다.
 * @param env — ConfigService
 * @param key — env 이름
 * @param fallback — 기본값(초)
 * @param min — 허용 최소값(초) — 너무 잦은 호출을 막는다
 * @returns 실행 간격(초)
 */
export function readIntervalSec(env: ConfigService, key: string, fallback: number, min: number): number {
  const n = Number(env.get<string>(key, String(fallback)));
  return Number.isFinite(n) && n >= min ? Math.trunc(n) : fallback;
}
