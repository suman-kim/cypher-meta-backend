/**
 * push-message.ts
 *
 * 앱으로 보내는 푸시 알림 1건의 형식을 정의한다. **모바일 앱과의 계약**이므로 필드 이름·값을 함부로 바꾸지 말 것.
 *
 *  - notification: { title, body }                      — 기기 알림창에 보이는 제목·본문
 *  - data: { kind: "match" | "live" | "test", url }      — 앱이 눌렸을 때 열 화면(앱 내부 경로 또는 https 방송 주소)
 *  - android: { priority: "high", notification: { channelId: "match" | "live", icon: "ic_stat_notify" } }
 *    (test 알림은 별도 채널 없이 "match" 채널을 쓴다. iOS(apns)는 아직 없다.)
 *
 * 데코레이터·외부 패키지를 쓰지 않는 순수 파일이다 — 감지 로직·발송기·테스트 스크립트가 함께 쓴다.
 * (테스트는 node --experimental-strip-types 로 이 파일을 직접 불러오므로 enum 등 변환이 필요한 문법을 쓰지 않는다.)
 */

/** 알림 종류 목록 — 앱이 data.kind 로 받아 화면 이동·표시 방식을 정한다 */
export const PUSH_KINDS = ["match", "live", "test"] as const;

/** 알림 종류 — match(전적 갱신) / live(방송 시작) / test(테스트 알림) */
export type PushKind = (typeof PUSH_KINDS)[number];

/** 발송할 알림 한 건(발송기에 넘기는 공통 형식) */
export interface PushMessage {
  /** 알림 종류(data.kind 로 전달) */
  kind: PushKind;
  /** 알림 제목(notification.title) */
  title: string;
  /** 알림 본문(notification.body) */
  body: string;
  /** 알림을 눌렀을 때 열 주소(data.url) — 앱 내부 경로("/players/...") 또는 외부 방송 주소("https://...") */
  url: string;
}

/** 앱이 미리 만들어 둔 안드로이드 알림 채널 ID */
export type AndroidChannelId = "match" | "live";

/** 안드로이드 상태바에 보일 작은 알림 아이콘의 리소스 이름(앱에 포함됨) */
export const ANDROID_NOTIFICATION_ICON = "ic_stat_notify";

/**
 * 알림 종류에 맞는 안드로이드 알림 채널을 고른다. test 는 전용 채널이 없어 match 채널을 쓴다.
 * @param kind — 알림 종류
 * @returns 안드로이드 알림 채널 ID
 */
export function androidChannelFor(kind: PushKind): AndroidChannelId {
  return kind === "live" ? "live" : "match";
}

/**
 * FCM 으로 보낼 페이로드(토큰 제외). firebase-admin 의 MulticastMessage 와 같은 모양이며,
 * 발송기는 여기에 tokens 만 더해 보낸다. (type 별칭이어야 data 가 문자열 사전 타입에 맞는다)
 */
export type FcmPayload = {
  /** 알림창에 보일 제목·본문 */
  notification: { title: string; body: string };
  /** 앱이 읽는 데이터(값은 모두 문자열이어야 함) */
  data: { kind: PushKind; url: string };
  /** 안드로이드 전용 옵션 — 높은 우선순위 + 채널·아이콘 */
  android: {
    priority: "high";
    notification: { channelId: AndroidChannelId; icon: string };
  };
};

/**
 * 알림 1건을 앱 계약에 맞는 FCM 페이로드로 바꾼다.
 * @param message — 보낼 알림
 * @returns tokens 를 뺀 FCM 멀티캐스트 메시지 본문
 */
export function buildFcmPayload(message: PushMessage): FcmPayload {
  return {
    notification: { title: message.title, body: message.body },
    data: { kind: message.kind, url: message.url },
    android: {
      priority: "high",
      notification: { channelId: androidChannelFor(message.kind), icon: ANDROID_NOTIFICATION_ICON },
    },
  };
}
