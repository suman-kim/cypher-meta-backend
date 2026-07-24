/**
 * password.util.ts
 * ------------------------------------------------------------------
 * 비회원(게스트) 비밀번호 해싱/검증 유틸리티.
 * 외부 라이브러리 없이 Node 내장 crypto 의 scrypt 를 사용하며,
 * 무작위 salt 를 붙여 "salt:hash"(둘 다 hex) 형식으로 저장한다.
 * 검증 시에는 timingSafeEqual 로 타이밍 공격에 안전하게 비교한다.
 * ------------------------------------------------------------------
 */
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

/**
 * 평문 비밀번호를 scrypt 로 해시한다.
 * 매 호출마다 16바이트 무작위 salt 를 생성해 사용하며, 결과는 "salt:hash"(hex) 형식이다.
 * @param password — 해시할 평문 비밀번호
 * @returns "salt:hash" 형식의 저장용 해시 문자열(둘 다 hex)
 */
/**
 * 비회원 비밀번호 해시. 별도 의존성 없이 Node 내장 crypto(scrypt) 사용.
 * 저장 형식: "salt:hash" (both hex)
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${derived}`;
}

/**
 * 평문 비밀번호가 저장된 해시와 일치하는지 검증한다.
 * 저장값에서 salt 를 분리해 동일 방식으로 파생 키를 만든 뒤 timingSafeEqual 로 비교한다.
 * @param password — 검증할 평문 비밀번호
 * @param stored — hashPassword 로 만든 "salt:hash" 저장값(없거나 null 이면 실패)
 * @returns 비밀번호가 일치하면 true, 그렇지 않으면 false
 */
export function verifyPassword(password: string, stored?: string | null): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  let derived: Buffer;
  try {
    derived = scryptSync(password, salt, 32);
  } catch {
    return false;
  }
  const hashBuf = Buffer.from(hash, "hex");
  if (hashBuf.length !== derived.length) return false;
  return timingSafeEqual(hashBuf, derived);
}
