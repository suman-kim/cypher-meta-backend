import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

/**
 * 비회원 비밀번호 해시. 별도 의존성 없이 Node 내장 crypto(scrypt) 사용.
 * 저장 형식: "salt:hash" (both hex)
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${derived}`;
}

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
