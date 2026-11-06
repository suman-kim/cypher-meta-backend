/**
 * push.controller.ts
 * ------------------------------------------------------------------
 * 푸시 알림 HTTP 컨트롤러(전역 prefix 포함 /api/push).
 *  - POST   /push/devices             기기 등록(installId 기준 upsert)
 *  - PUT    /push/subscriptions       구독 목록 동기화(전체 교체, 서버는 차이만 반영)
 *  - DELETE /push/devices/:installId  기기·구독 삭제
 *  - POST   /push/test                테스트 알림 1건(같은 기기 60초에 1번)
 * 로그인 대신 앱이 만든 installId(UUID v4)로 기기를 구분한다. 라우팅·바인딩만 하고 로직은 서비스로 넘긴다.
 * ------------------------------------------------------------------
 */
import { Body, Controller, Delete, HttpCode, Param, Post, Put } from "@nestjs/common";
import { InstallIdParam, RegisterDeviceDto, SyncSubscriptionsDto, TestPushDto } from "./dto";
import { PushDeliveryService } from "./push-delivery.service";
import { PushService } from "./push.service";

/** 푸시 알림 기기·구독·테스트 API */
@Controller("push")
export class PushController {
  /**
   * @param push — 기기·구독 데이터 서비스
   * @param delivery — 발송 서비스(테스트 알림)
   */
  constructor(
    private readonly push: PushService,
    private readonly delivery: PushDeliveryService,
  ) {}

  /**
   * 기기 등록(처음) 또는 토큰 갱신.
   * 라우트: POST /push/devices
   * @param dto — { installId, token, platform }
   * @returns { ok: true }
   */
  @Post("devices")
  @HttpCode(200)
  registerDevice(@Body() dto: RegisterDeviceDto) {
    return this.push.registerDevice(dto);
  }

  /**
   * 구독 목록 동기화.
   * 라우트: PUT /push/subscriptions
   * @param dto — { installId, players: [{ playerId, nickname }], lives: [{ platform, channelId, channelName }] }
   * @returns { ok: true, players, lives } — 동기화 후 구독 수
   */
  @Put("subscriptions")
  syncSubscriptions(@Body() dto: SyncSubscriptionsDto) {
    return this.push.syncSubscriptions(dto);
  }

  /**
   * 기기와 구독 삭제(없어도 성공).
   * 라우트: DELETE /push/devices/:installId
   * @param p — 경로 파라미터 { installId }
   * @returns { ok: true }
   */
  @Delete("devices/:installId")
  removeDevice(@Param() p: InstallIdParam) {
    return this.push.removeDevice(p.installId);
  }

  /**
   * 테스트 알림 1건 발송.
   * 라우트: POST /push/test
   * @param dto — { installId }
   * @returns { ok: true } 또는 { ok: false, reason }
   */
  @Post("test")
  @HttpCode(200)
  sendTest(@Body() dto: TestPushDto) {
    return this.delivery.sendTest(dto.installId);
  }
}
