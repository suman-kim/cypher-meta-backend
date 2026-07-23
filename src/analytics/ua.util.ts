/** 의존성 없는 경량 User-Agent 파서 (browser / os / device) */
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
