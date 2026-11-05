/**
 * dto.ts
 * ------------------------------------------------------------------
 * 푸시 알림 API 의 요청 DTO 및 검증 규칙 모음.
 * 전역 ValidationPipe(whitelist·transform)가 걸려 있으므로 여기에 선언한 필드만 서비스로 넘어간다.
 * 중첩 배열(players/lives)은 @ValidateNested + @Type 으로 항목마다 검증한다.
 * ------------------------------------------------------------------
 */
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";

/** 알림을 받을 기기 플랫폼 허용값 */
export const DEVICE_PLATFORMS: string[] = ["android", "ios"];
/** 방송 알림을 지원하는 라이브 플랫폼 허용값 */
export const LIVE_PLATFORMS: string[] = ["chzzk", "youtube", "soop"];
/** 기기 1대가 구독할 수 있는 최대 플레이어 수(내 계정 1 + 즐겨찾기 30) */
export const MAX_PLAYER_SUBSCRIPTIONS = 31;
/** 기기 1대가 구독할 수 있는 최대 채널 수 */
export const MAX_LIVE_SUBSCRIPTIONS = 100;
/** Neople playerId 형식(32자리 소문자 16진수) */
export const PLAYER_ID_PATTERN = /^[0-9a-f]{32}$/;

/** installId 검증 오류 문구 */
const INSTALL_ID_MESSAGE = "installId 는 UUID 형식이어야 합니다.";

/**
 * 기기 등록 본문 DTO.
 * POST /push/devices
 */
export class RegisterDeviceDto {
  /** 앱이 설치 시 만든 설치 ID(UUID) */
  @IsUUID("all", { message: INSTALL_ID_MESSAGE })
  installId: string;

  /** FCM 등록 토큰(1~4096자) */
  @IsString({ message: "token 은 문자열이어야 합니다." })
  @Length(1, 4096, { message: "token 은 1~4096자여야 합니다." })
  token: string;

  /** 기기 플랫폼 — "android" | "ios" */
  @IsIn(DEVICE_PLATFORMS, { message: "platform 은 android 또는 ios 여야 합니다." })
  platform: string;
}

/** 구독할 플레이어 1명 */
export class PlayerSubscriptionDto {
  /** Neople playerId(32자리 소문자 16진수) */
  @Matches(PLAYER_ID_PATTERN, { message: "playerId 는 32자리 16진수여야 합니다." })
  playerId: string;

  /** 표시용 닉네임(40자 이하, 빈 값 가능) */
  @IsString({ message: "nickname 은 문자열이어야 합니다." })
  @MaxLength(40, { message: "nickname 은 40자 이하여야 합니다." })
  nickname: string;
}

/** 구독할 방송 채널 1개 */
export class LiveSubscriptionDto {
  /** 방송 플랫폼 — "chzzk" | "youtube" | "soop" */
  @IsIn(LIVE_PLATFORMS, { message: "platform 은 chzzk, youtube, soop 중 하나여야 합니다." })
  platform: string;

  /** 플랫폼의 채널 ID(1~128자, 공백 없음) */
  @IsString({ message: "channelId 는 문자열이어야 합니다." })
  @Matches(/^\S+$/, { message: "channelId 를 공백 없이 입력해 주세요." })
  @MaxLength(128, { message: "channelId 는 128자 이하여야 합니다." })
  channelId: string;

  /** 표시용 채널 이름(80자 이하, 빈 값 가능) */
  @IsString({ message: "channelName 은 문자열이어야 합니다." })
  @MaxLength(80, { message: "channelName 은 80자 이하여야 합니다." })
  channelName: string;
}

/**
 * 구독 목록 동기화 본문 DTO(전체 교체 — 서버는 차이만 반영).
 * PUT /push/subscriptions
 */
export class SyncSubscriptionsDto {
  /** 구독을 바꿀 기기의 설치 ID */
  @IsUUID("all", { message: INSTALL_ID_MESSAGE })
  installId: string;

  /** 전적 갱신 알림을 받을 플레이어 목록(최대 31명, 빈 배열이면 모두 해제) */
  @IsArray({ message: "players 는 배열이어야 합니다." })
  @ArrayMaxSize(MAX_PLAYER_SUBSCRIPTIONS, { message: `players 는 최대 ${MAX_PLAYER_SUBSCRIPTIONS}명까지입니다.` })
  @ValidateNested({ each: true })
  @Type(() => PlayerSubscriptionDto)
  players: PlayerSubscriptionDto[];

  /** 방송 시작 알림을 받을 채널 목록(최대 100개, 빈 배열이면 모두 해제) */
  @IsArray({ message: "lives 는 배열이어야 합니다." })
  @ArrayMaxSize(MAX_LIVE_SUBSCRIPTIONS, { message: `lives 는 최대 ${MAX_LIVE_SUBSCRIPTIONS}개까지입니다.` })
  @ValidateNested({ each: true })
  @Type(() => LiveSubscriptionDto)
  lives: LiveSubscriptionDto[];
}

/**
 * 경로의 installId 파라미터 DTO.
 * DELETE /push/devices/:installId
 */
export class InstallIdParam {
  /** 지울 기기의 설치 ID */
  @IsUUID("all", { message: INSTALL_ID_MESSAGE })
  installId: string;
}

/**
 * 테스트 알림 본문 DTO.
 * POST /push/test
 */
export class TestPushDto {
  /** 테스트 알림을 받을 기기의 설치 ID */
  @IsUUID("all", { message: INSTALL_ID_MESSAGE })
  installId: string;
}
