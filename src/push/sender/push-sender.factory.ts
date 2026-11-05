/**
 * push-sender.factory.ts
 *
 * env 를 보고 어떤 발송기를 쓸지 정한다(PUSH_SENDER 프로바이더의 팩토리).
 *  - FIREBASE_SERVICE_ACCOUNT 가 있으면 FcmPushSender. 값은 서비스 계정 JSON 원문 또는 그 base64.
 *  - 없거나 읽을 수 없으면 NoopPushSender(경고 1회).
 * 비밀값이 로그에 새지 않도록, 파싱 오류 메시지(입력 일부가 들어갈 수 있음)는 그대로 찍지 않는다.
 */
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FcmPushSender, FirebaseServiceAccount } from "./fcm-push-sender";
import { NoopPushSender } from "./noop-push-sender";
import { PushSender } from "./push-sender";

/** 서비스 계정 env 이름 */
export const FIREBASE_SERVICE_ACCOUNT_ENV = "FIREBASE_SERVICE_ACCOUNT";

/**
 * 서비스 계정 env 값(JSON 원문 또는 base64)을 읽어 발송에 필요한 값만 꺼낸다.
 * @param raw — env 값
 * @returns 프로젝트 ID·이메일·비공개 키
 * @throws 형식이 맞지 않으면 Error(메시지에 입력값을 넣지 않음)
 */
export function parseServiceAccount(raw: string): FirebaseServiceAccount {
  const text = raw.trim();
  const json = text.startsWith("{") ? text : Buffer.from(text, "base64").toString("utf8").trim();
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error("JSON(또는 JSON 을 base64 로 바꾼 값)이 아닙니다");
  }
  const projectId = String(obj.project_id ?? obj.projectId ?? "");
  const clientEmail = String(obj.client_email ?? obj.clientEmail ?? "");
  // env 에 넣으며 줄바꿈이 "\n" 글자로 바뀐 경우를 되돌린다.
  const privateKey = String(obj.private_key ?? obj.privateKey ?? "").replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("project_id / client_email / private_key 중 빠진 값이 있습니다");
  }
  return { projectId, clientEmail, privateKey };
}

/**
 * env 에 맞는 발송기를 만든다.
 * @param config — 환경변수 접근용 ConfigService
 * @returns FCM 발송기 또는 빈 발송기
 */
export function createPushSender(config: ConfigService): PushSender {
  const logger = new Logger("PushSenderFactory");
  const raw = config.get<string>(FIREBASE_SERVICE_ACCOUNT_ENV);
  if (!raw || !raw.trim()) return new NoopPushSender(`${FIREBASE_SERVICE_ACCOUNT_ENV} 미설정`);
  try {
    return new FcmPushSender(parseServiceAccount(raw));
  } catch (e) {
    logger.error(`${FIREBASE_SERVICE_ACCOUNT_ENV} 를 읽지 못했습니다: ${(e as Error).message}`);
    return new NoopPushSender(`${FIREBASE_SERVICE_ACCOUNT_ENV} 형식 오류`);
  }
}
