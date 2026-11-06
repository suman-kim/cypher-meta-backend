/**
 * report-target.ts — 신고 대상 종류별 처리 방식(전략 패턴)의 공통 계약.
 *
 * 신고 서비스는 대상이 글인지 댓글인지 모른 채 이 인터페이스만 부른다.
 * 새 신고 대상(예: 코스튬 제보)을 붙일 때는 ReportTarget 구현 클래스를 만들고
 * ReportTargetRegistry 생성자에 넣기만 하면 된다(서비스·컨트롤러는 그대로).
 */
import type { ReportTargetType } from "./report-logic";

/** 신고 당시 대상의 모습(관리자 확인용 사본) */
export interface ReportSnapshot {
  /** 제목(글) 또는 소속 글·업데이트 제목(댓글). 없으면 null */
  title: string | null;
  /** 본문 */
  content: string;
  /** 작성자 닉네임 */
  authorName: string | null;
  /** 관리자가 대상을 열어 볼 화면 경로 */
  link: string | null;
}

/** 신고 대상 종류 하나의 처리 방식 */
export interface ReportTarget {
  /** 이 구현이 맡는 대상 종류 */
  readonly type: ReportTargetType;

  /**
   * 신고할 수 있는 대상인지 확인하고 지금 모습을 가져온다.
   * @param id — 대상 ID(UUID)
   * @returns 대상 사본, 없거나 공개되지 않은 대상이면 null
   */
  snapshot(id: string): Promise<ReportSnapshot | null>;

  /**
   * 관리자 처리로 대상을 지운다(대댓글 등 딸린 것 포함).
   * @param id — 대상 ID(UUID)
   * @returns 지웠으면 true, 이미 없으면 false
   */
  remove(id: string): Promise<boolean>;
}
