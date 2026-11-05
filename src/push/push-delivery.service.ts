/**
 * push-delivery.service.ts
 *
 * 알림 발송 서비스. 설치 ID 목록을 받아 토큰을 찾고, 발송기(PushSender — FCM 또는 Noop)로 보낸 뒤
 * 무효 토큰이 돌아오면 그 기기(와 구독)를 지운다. 감지 작업과 테스트 알림 API 가 함께 쓴다.
 * 테스트 알림은 같은 기기에 60초에 한 번만 보낼 수 있다(메모리 쿨다운 — 서버 재시작 시 초기화).
 */
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { PushMessage } from "./push-message";
import { PushService } from "./push.service";
import { emptySendResult, PUSH_SENDER, PushSendResult, PushSender } from "./sender/push-sender";

/** 테스트 알림 쿨다운(60초) */
const TEST_COOLDOWN_MS = 60 * 1000;

/** 발송기가 꺼져 있을 때 테스트 API 가 돌려주는 이유 */
export const SENDER_DISABLED_REASON = "FCM 미설정";

/** 한 번의 발송 결과(발송기 결과 + 대상 기기 수 + 지운 기기 수) */
export interface DeliveryResult extends PushSendResult {
  /** 토큰을 찾은 대상 기기 수 */
  devices: number;
  /** 무효 토큰이라 지운 기기 수 */
  removedDevices: number;
}

/** 테스트 알림 API 응답 */
export interface TestPushResult {
  /** 실제로 1건 이상 발송했는지 */
  ok: boolean;
  /** ok=false 일 때 이유(쉬운 한국어) */
  reason?: string;
}

/** 알림 발송 서비스 */
@Injectable()
export class PushDeliveryService {
  /** 로거 */
  private readonly logger = new Logger(PushDeliveryService.name);
  /** 설치 ID별 마지막 테스트 알림 발송 시각(ms) */
  private readonly lastTestAt = new Map<string, number>();

  /**
   * @param sender — 발송기(FCM 또는 Noop, env 로 결정)
   * @param push — 기기·구독 데이터 서비스
   */
  constructor(
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
    private readonly push: PushService,
  ) {}

  /** 실제로 알림을 보낼 수 있는지(FCM 설정 여부) */
  get enabled(): boolean {
    return this.sender.enabled;
  }

  /**
   * 여러 기기에 같은 알림을 보내고, 무효 토큰 기기는 지운다.
   * @param installIds — 받을 기기의 설치 ID 목록(중복 가능)
   * @param message — 보낼 알림
   * @returns 발송 결과
   */
  async deliver(installIds: string[], message: PushMessage): Promise<DeliveryResult> {
    const ids = [...new Set(installIds)];
    const devices = await this.push.findDeviceTokens(ids);
    if (!devices.length) return { ...emptySendResult(), devices: 0, removedDevices: 0 };

    const res = await this.sender.send(
      devices.map((d) => d.token),
      message,
    );
    let removedDevices = 0;
    if (res.invalidTokens.length) {
      removedDevices = await this.push.removeDevicesByTokens(res.invalidTokens);
      this.logger.log(`무효 토큰 기기 ${removedDevices}대 삭제`);
    }
    return { ...res, devices: devices.length, removedDevices };
  }

  /**
   * 기기 1대에 테스트 알림을 보낸다.
   *  - 기기가 없으면 404, 발송기가 꺼져 있으면 { ok: false, reason: "FCM 미설정" }(예외 아님)
   *  - 같은 기기는 60초에 한 번만(넘으면 400)
   * @param installId — 받을 기기의 설치 ID
   * @returns 발송 여부와 이유
   */
  async sendTest(installId: string): Promise<TestPushResult> {
    if (!(await this.push.deviceExists(installId))) throw new NotFoundException("등록되지 않은 기기입니다");
    if (!this.sender.enabled) return { ok: false, reason: SENDER_DISABLED_REASON };

    const now = Date.now();
    for (const [id, t] of this.lastTestAt) if (now - t >= TEST_COOLDOWN_MS) this.lastTestAt.delete(id);
    const last = this.lastTestAt.get(installId);
    if (last !== undefined) {
      const waitSec = Math.ceil((TEST_COOLDOWN_MS - (now - last)) / 1000);
      throw new BadRequestException(`테스트 알림은 1분에 한 번만 보낼 수 있어요. ${waitSec}초 뒤에 다시 눌러 주세요.`);
    }
    this.lastTestAt.set(installId, now);

    const res = await this.deliver([installId], {
      kind: "test",
      title: "테스트 알림",
      body: "알림이 잘 도착했어요. 이제 전적·방송 알림을 받을 수 있어요.",
      url: "/notifications",
    });
    if (res.successCount > 0) return { ok: true };
    if (res.removedDevices > 0) {
      return { ok: false, reason: "알림 주소가 만료되어 기기 등록을 지웠어요. 앱을 다시 열어 주세요." };
    }
    return { ok: false, reason: "알림을 보내지 못했어요. 잠시 후 다시 시도해 주세요." };
  }
}
