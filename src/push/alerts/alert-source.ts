/**
 * alert-source.ts
 *
 * 푸시 주기 작업(알림 감지·기기 정리)의 공통 규격. 스케줄러(PushSchedulerService)는 ALERT_SOURCES 로 받은
 * 목록을 각자의 간격(intervalSec)대로 돌리기만 한다. 새 알림 종류(또는 주기 작업)를 추가할 때는 이 인터페이스를
 * 구현한 클래스를 만들고 push.module.ts 의 ALERT_SOURCES 목록에 넣으면 된다.
 */

/** 주기적으로 돌며 알릴 일을 찾아 보내는 감지 작업 */
export interface AlertSource {
  /** 작업 이름(로그·중복 실행 방지 키) */
  readonly name: string;
  /** 실행 간격(초) */
  readonly intervalSec: number;
  /** 한 번 점검하고, 알릴 것이 있으면 보낸다. 예외는 스케줄러가 잡아 로그로 남긴다 */
  run(): Promise<void>;
}

/** 감지 작업 목록을 주입할 때 쓰는 DI 토큰 */
export const ALERT_SOURCES = Symbol("ALERT_SOURCES");
