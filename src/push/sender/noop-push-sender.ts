/**
 * noop-push-sender.ts
 *
 * FCM 설정(FIREBASE_SERVICE_ACCOUNT)이 없을 때 쓰는 빈 발송기. 실제로는 아무것도 보내지 않고,
 * 만들어질 때 경고를 한 번 남긴 뒤 보낼 뻔한 알림 내용은 debug 로그로만 남긴다.
 * 덕분에 로컬 개발 환경에서도 감지 작업 전체 흐름을 그대로 돌려 볼 수 있다.
 */
import { Logger } from "@nestjs/common";
import type { PushMessage } from "../push-message";
import { emptySendResult, PushSendResult, PushSender } from "./push-sender";

/** 아무것도 보내지 않는 발송기(설정 누락 시 대체용) */
export class NoopPushSender implements PushSender {
  /** 발송기 이름 */
  readonly name = "noop";
  /** 실제 발송 불가 */
  readonly enabled = false;
  /** 로거 */
  private readonly logger = new Logger(NoopPushSender.name);

  /**
   * @param reason — 빈 발송기를 쓰게 된 이유(경고 로그에 남김. 비밀값은 넣지 말 것)
   */
  constructor(reason: string) {
    this.logger.warn(`푸시 발송 꺼짐(${reason}) — 알림은 실제로 보내지 않고 로그에만 남깁니다.`);
  }

  /**
   * 보내지 않고 내용만 debug 로그로 남긴다.
   * @param tokens — 보낼 뻔한 토큰 목록
   * @param message — 보낼 뻔한 알림
   * @returns 항상 0건 결과
   */
  async send(tokens: string[], message: PushMessage): Promise<PushSendResult> {
    this.logger.debug(`[보내지 않음] 기기 ${tokens.length}대 ← ${JSON.stringify(message)}`);
    return emptySendResult();
  }
}
