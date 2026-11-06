/**
 * push-sender.ts
 *
 * 푸시 발송기 공통 규격(전략 패턴). 실제 구현은 두 가지다.
 *  - FcmPushSender  : firebase-admin 으로 FCM 에 보낸다(FIREBASE_SERVICE_ACCOUNT 가 있을 때).
 *  - NoopPushSender : 아무것도 보내지 않고 로그만 남긴다(설정이 없을 때 — 로컬 개발 등).
 * 어느 쪽을 쓸지는 push-sender.factory.ts 가 env 를 보고 정한다. 다른 발송 수단(APNs 직접 등)을
 * 붙일 때도 이 인터페이스만 구현하면 된다.
 */
import type { PushMessage } from "../push-message";

/** 발송 결과 */
export interface PushSendResult {
  /** 발송에 성공한 토큰 수 */
  successCount: number;
  /** 발송에 실패한 토큰 수(무효 토큰 포함) */
  failureCount: number;
  /** 더 이상 쓸 수 없는 토큰(앱 삭제·토큰 만료 등) — 호출한 쪽이 해당 기기를 지운다 */
  invalidTokens: string[];
}

/** 푸시 발송기 */
export interface PushSender {
  /** 발송기 이름(로그용) — "fcm" | "noop" */
  readonly name: string;
  /** 실제로 알림을 보낼 수 있는지(false 면 Noop) */
  readonly enabled: boolean;
  /**
   * 여러 기기 토큰에 같은 알림을 보낸다.
   * @param tokens — FCM 등록 토큰 목록(중복 가능 — 구현이 정리한다)
   * @param message — 보낼 알림
   * @returns 발송 결과
   */
  send(tokens: string[], message: PushMessage): Promise<PushSendResult>;
}

/** 발송기 주입용 DI 토큰 */
export const PUSH_SENDER = Symbol("PUSH_SENDER");

/**
 * '아무 일도 없었음' 결과를 새로 만든다(보낼 대상이 없을 때 등). 배열을 공유하지 않도록 매번 새 객체를 돌려준다.
 * @returns 0건 결과
 */
export function emptySendResult(): PushSendResult {
  return { successCount: 0, failureCount: 0, invalidTokens: [] };
}
