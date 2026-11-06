/**
 * push.module.ts
 * ------------------------------------------------------------------
 * 푸시 알림 기능 모듈.
 *  - 기기·구독 API(PushController/PushService)
 *  - 발송(PushDeliveryService + PUSH_SENDER: env 에 따라 FCM 또는 Noop — 전략 패턴)
 *  - 주기 작업(ALERT_SOURCES: 방송 시작·전적 갱신 감지 + 90일 지난 기기 정리)과 그 스케줄러
 * 새 알림 종류를 추가하려면 AlertSource 를 구현한 클래스를 providers 와 ALERT_SOURCES 목록에 넣는다.
 * ------------------------------------------------------------------
 */
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ChzzkModule } from "../chzzk/chzzk.module";
import { PushDevice, PushSubscription } from "../database/entities";
import { NeopleModule } from "../neople/neople.module";
import { YoutubeModule } from "../youtube/youtube.module";
import { ALERT_SOURCES, AlertSource } from "./alerts/alert-source";
import { DeviceCleanupJob } from "./alerts/device-cleanup.job";
import { LiveAlertSource } from "./alerts/live-alert.source";
import { MatchAlertSource } from "./alerts/match-alert.source";
import { PushDeliveryService } from "./push-delivery.service";
import { PushSchedulerService } from "./push-scheduler.service";
import { PushController } from "./push.controller";
import { PushService } from "./push.service";
import { PUSH_SENDER } from "./sender/push-sender";
import { createPushSender } from "./sender/push-sender.factory";

/** 푸시 알림 모듈 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PushDevice, PushSubscription]), // 기기·구독 리포지토리
    NeopleModule, // 전적 감지 — Neople 매치 목록 조회
    ChzzkModule, // 방송 감지 — 치지직 라이브 목록
    YoutubeModule, // 방송 감지 — 유튜브 라이브 목록
  ],
  controllers: [PushController],
  providers: [
    // 발송기: FIREBASE_SERVICE_ACCOUNT 가 있으면 FCM, 없으면 Noop
    { provide: PUSH_SENDER, inject: [ConfigService], useFactory: createPushSender },
    PushService,
    PushDeliveryService,
    LiveAlertSource,
    MatchAlertSource,
    DeviceCleanupJob,
    // 스케줄러가 돌릴 주기 작업 목록(순서 = 첫 실행 순서): 방송 감지 → 전적 감지 → 오래된 기기 정리
    {
      provide: ALERT_SOURCES,
      inject: [LiveAlertSource, MatchAlertSource, DeviceCleanupJob],
      useFactory: (...sources: AlertSource[]): AlertSource[] => sources,
    },
    PushSchedulerService,
  ],
})
export class PushModule {}
