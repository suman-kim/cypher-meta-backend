/**
 * device-cleanup.job.ts
 *
 * 오래 안 쓰인 기기 정리 작업(DeviceCleanupJob). 개인정보처리방침에 적은 보관 기간에 맞춰,
 * 마지막 사용(lastSeenAt) 후 90일이 지난 기기와 그 구독을 지운다.
 *  - lastSeenAt 은 기기 등록(POST /push/devices)과 구독 동기화(PUT /push/subscriptions) 때 갱신된다
 *    (앱은 실행할 때마다 둘 다 호출하므로, 90일 동안 앱을 안 연 기기만 지워진다).
 *  - 간격은 env PUSH_CLEANUP_INTERVAL_SEC(기본 86400 = 하루 1번, 최소 3600).
 * 감지 작업과 같은 AlertSource 규격으로 만들어 같은 스케줄러(PushSchedulerService)가 돌린다.
 */
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PushService } from "../push.service";
import { AlertSource } from "./alert-source";
import { readIntervalSec } from "./interval";

/** 기기 보관 기간(일) — 개인정보처리방침과 같은 값. 바꾸려면 방침도 함께 고칠 것 */
export const DEVICE_RETENTION_DAYS = 90;

/**
 * 보관 기간이 지난 기준 시각을 계산한다(이 시각보다 lastSeenAt 이 이르면 삭제 대상).
 * @param now — 현재 시각
 * @param days — 보관 기간(일)
 * @returns 기준 시각
 */
export function retentionCutoff(now: Date, days: number = DEVICE_RETENTION_DAYS): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** 오래 안 쓰인 기기 정리 작업 */
@Injectable()
export class DeviceCleanupJob implements AlertSource {
  /** 작업 이름 */
  readonly name = "cleanup";
  /** 실행 간격(초) — PUSH_CLEANUP_INTERVAL_SEC, 기본 86400, 최소 3600 */
  readonly intervalSec: number;
  /** 로거 */
  private readonly logger = new Logger(DeviceCleanupJob.name);

  /**
   * @param env — 간격 env 읽기용
   * @param push — 기기 삭제
   */
  constructor(
    env: ConfigService,
    private readonly push: PushService,
  ) {
    this.intervalSec = readIntervalSec(env, "PUSH_CLEANUP_INTERVAL_SEC", 86400, 3600);
  }

  /** 마지막 사용 후 90일이 지난 기기와 그 구독을 지운다 */
  async run(): Promise<void> {
    const cutoff = retentionCutoff(new Date());
    const removed = await this.push.removeStaleDevices(cutoff);
    const msg = `오래 안 쓰인 기기 정리: ${removed}대 삭제(마지막 사용 ${cutoff.toISOString()} 이전)`;
    if (removed > 0) this.logger.log(msg);
    else this.logger.debug(msg);
  }
}
