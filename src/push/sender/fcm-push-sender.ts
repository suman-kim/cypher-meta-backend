/**
 * fcm-push-sender.ts
 *
 * firebase-admin 으로 FCM(Firebase Cloud Messaging)에 알림을 보내는 발송기.
 *  - 한 번에 최대 500개 토큰씩 sendEachForMulticast 로 보낸다(FCM 한도).
 *  - 응답 오류가 '등록되지 않은 토큰'·'잘못된 토큰'이면 invalidTokens 로 돌려줘 호출한 쪽이 기기를 지우게 한다.
 *  - 메시지 모양은 push-message.ts 의 buildFcmPayload(앱과의 계약)를 그대로 쓴다.
 */
import { Logger } from "@nestjs/common";
import { App, cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging, Messaging } from "firebase-admin/messaging";
import { buildFcmPayload, PushMessage } from "../push-message";
import { emptySendResult, PushSendResult, PushSender } from "./push-sender";

/** FCM 멀티캐스트 1회 최대 토큰 수 */
const FCM_MULTICAST_LIMIT = 500;

/** 이 오류 코드면 토큰이 더는 쓸 수 없으므로 기기를 지운다 */
const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

/** firebase-admin 앱 이름(기본 앱과 겹치지 않게 따로 둔다) */
const FIREBASE_APP_NAME = "cyphers-push";

/** 서비스 계정에서 발송에 필요한 값 */
export interface FirebaseServiceAccount {
  /** Firebase 프로젝트 ID */
  projectId: string;
  /** 서비스 계정 이메일 */
  clientEmail: string;
  /** 서비스 계정 비공개 키(PEM) */
  privateKey: string;
}

/** FCM 발송기 */
export class FcmPushSender implements PushSender {
  /** 발송기 이름 */
  readonly name = "fcm";
  /** 실제 발송 가능 */
  readonly enabled = true;
  /** 로거 */
  private readonly logger = new Logger(FcmPushSender.name);
  /** FCM 메시징 클라이언트 */
  private readonly messaging: Messaging;

  /**
   * firebase-admin 앱을 초기화한다(같은 이름의 앱이 이미 있으면 재사용 — watch 재시작 대비).
   * @param account — 서비스 계정 값(프로젝트 ID·이메일·비공개 키)
   */
  constructor(account: FirebaseServiceAccount) {
    const existing = getApps().find((a) => a.name === FIREBASE_APP_NAME);
    const app: App = existing ?? initializeApp({ credential: cert(account), projectId: account.projectId }, FIREBASE_APP_NAME);
    this.messaging = getMessaging(app);
    this.logger.log(`FCM 발송 켜짐(project=${account.projectId})`);
  }

  /**
   * 토큰 목록에 같은 알림을 500개씩 나눠 보낸다. 한 묶음 전체가 실패하면(네트워크 등) 그 묶음은 실패로 세고 계속한다.
   * @param tokens — FCM 등록 토큰 목록
   * @param message — 보낼 알림
   * @returns 성공·실패 수와 무효 토큰 목록
   */
  async send(tokens: string[], message: PushMessage): Promise<PushSendResult> {
    const unique = [...new Set(tokens.filter((t) => typeof t === "string" && t.length > 0))];
    const result = emptySendResult();
    const payload = buildFcmPayload(message);
    for (let i = 0; i < unique.length; i += FCM_MULTICAST_LIMIT) {
      const chunk = unique.slice(i, i + FCM_MULTICAST_LIMIT);
      try {
        const res = await this.messaging.sendEachForMulticast({ tokens: chunk, ...payload });
        result.successCount += res.successCount;
        result.failureCount += res.failureCount;
        res.responses.forEach((r, idx) => {
          if (r.success) return;
          const code = r.error?.code ?? "";
          if (INVALID_TOKEN_CODES.has(code)) result.invalidTokens.push(chunk[idx]);
          else this.logger.warn(`FCM 발송 실패(${code || "알 수 없음"}): ${r.error?.message ?? ""}`);
        });
      } catch (e) {
        result.failureCount += chunk.length;
        this.logger.error(`FCM 멀티캐스트 실패(${chunk.length}건): ${(e as Error).message}`);
      }
    }
    return result;
  }
}
