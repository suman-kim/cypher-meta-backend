/**
 * ua.util.ts
 *
 * 외부 라이브러리 없이 User-Agent 문자열에서 브라우저/OS/기기 종류를 추정하는 유틸.
 * 애널리틱스 트래킹 시 방문자 환경 분류에 사용된다.
 */

/**
 * 의존성 없는 경량 User-Agent 파서 (browser / os / device)
 *
 * 정규식으로 UA 문자열을 검사해 기기 종류, OS, 브라우저를 판별한다.
 * 매칭 순서가 중요하며(예: Edge/Opera/Samsung 을 Chrome 보다 먼저 검사),
 * 판별하지 못한 값은 "기타"(device 는 "desktop")로 처리한다.
 *
 * @param ua — 원본 User-Agent 문자열(없거나 null 이면 빈 문자열로 취급)
 * @returns { browser, os, device } 판별 결과
 *   browser: "KakaoTalk" | "Whale/Naver" | "Edge" | "Opera" | "Samsung" | "Firefox" | "Chrome" | "Safari" | "기타"
 *   os: "Windows" | "macOS" | "Android" | "iOS" | "ChromeOS" | "Linux" | "기타"
 *   device: "bot" | "tablet" | "mobile" | "desktop"
 */
export function parseUA(ua?: string | null): {
  browser: string;
  os: string;
  device: string;
} {
  const s = ua ?? "";

  // device
  let device = "desktop";
  if (/bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|embedly/i.test(s)) {
    device = "bot";
  } else if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(s)) {
    device = "tablet";
  } else if (/mobi|iphone|ipod|android.*mobile|windows phone|blackberry/i.test(s)) {
    device = "mobile";
  }

  // os
  let os = "기타";
  if (/windows nt/i.test(s)) os = "Windows";
  else if (/mac os x|macintosh/i.test(s)) os = "macOS";
  else if (/android/i.test(s)) os = "Android";
  else if (/iphone|ipad|ipod|ios/i.test(s)) os = "iOS";
  else if (/cros/i.test(s)) os = "ChromeOS";
  else if (/linux/i.test(s)) os = "Linux";

  // browser (순서 중요: Edge/Opera/Samsung 을 Chrome 보다 먼저)
  let browser = "기타";
  if (/kakaotalk/i.test(s)) browser = "KakaoTalk";
  else if (/naver\(inapp/i.test(s) || /whale/i.test(s)) browser = "Whale/Naver";
  else if (/edg\//i.test(s)) browser = "Edge";
  else if (/opr\/|opera/i.test(s)) browser = "Opera";
  else if (/samsungbrowser/i.test(s)) browser = "Samsung";
  else if (/firefox\/|fxios/i.test(s)) browser = "Firefox";
  else if (/chrome\/|crios/i.test(s)) browser = "Chrome";
  else if (/safari\//i.test(s)) browser = "Safari";

  return { browser, os, device };
}
