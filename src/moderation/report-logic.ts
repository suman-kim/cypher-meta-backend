/**
 * report-logic.ts — 신고 처리의 순수 로직(DB·Nest 의존 없음, test/moderation-logic.test.ts 로 검증).
 *
 *  - 허용값 목록(대상 종류·사유·처리 상태·처리 방법): DTO 의 @IsIn 과 서비스가 함께 쓴다.
 *  - 신고자 임의 ID 해시, 본문 사본 자르기.
 *  - 신고 행들을 대상별로 묶어 관리자 화면용 요약을 만든다.
 */
import { createHash } from "node:crypto";

/** 신고할 수 있는 대상 종류 — 커뮤니티 글 / 커뮤니티 댓글 / 업데이트 노트 댓글 */
export const REPORT_TARGET_TYPES = ["post", "comment", "update_comment"] as const;
/** 신고 대상 종류 */
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

/** 신고 사유 — 스팸·광고 / 욕설·비방 / 음란물 / 불법 정보 / 개인정보 노출 / 기타 */
export const REPORT_REASONS = ["spam", "abuse", "sexual", "illegal", "privacy", "other"] as const;
/** 신고 사유 */
export type ReportReason = (typeof REPORT_REASONS)[number];

/** 처리 상태 — 대기 / 삭제함 / 문제없음 */
export const REPORT_STATUSES = ["pending", "deleted", "dismissed"] as const;
/** 처리 상태 */
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** 관리자 처리 방법 — 대상 삭제 / 문제없음(신고만 닫기) */
export const REPORT_ACTIONS = ["delete", "dismiss"] as const;
/** 관리자 처리 방법 */
export type ReportAction = (typeof REPORT_ACTIONS)[number];

/** 관리자 목록 보기 — 대기 중 / 처리됨 */
export const REPORT_VIEWS = ["pending", "handled"] as const;
/** 관리자 목록 보기 */
export type ReportView = (typeof REPORT_VIEWS)[number];

/** 본문 사본 최대 길이(글자) */
export const SNAPSHOT_MAX = 2000;
/** 제목 사본 최대 길이(글자) */
export const SNAPSHOT_TITLE_MAX = 200;
/** 신고자 1명이 24시간 동안 넣을 수 있는 신고 수 — 장난 신고로 관리자 목록이 넘치는 것을 막는다 */
export const MAX_REPORTS_PER_DAY = 20;
/** 처리한 신고 기록 보관 기간(일) — 개인정보처리방침 '신고 기록: 운영진 처리 후 1년'과 같아야 한다 */
export const REPORT_RETENTION_DAYS = 365;
/** 묶음 하나에 보여 줄 상세 설명 최대 개수 */
export const MAX_DETAILS_PER_GROUP = 5;

/**
 * 신고자 임의 ID 를 저장용 해시로 바꾼다(원래 값은 저장하지 않는다).
 * @param key — 브라우저가 만든 임의 ID
 * @returns SHA-256 16진수 64자
 */
export function hashReporterKey(key: string): string {
  return createHash("sha256").update(`cm-report:${key.trim()}`).digest("hex");
}

/**
 * 글자 수 기준으로 자른다(이모지 등 서로게이트 쌍을 반으로 자르지 않게 코드포인트 단위).
 * @param text — 원문(null 이면 빈 문자열)
 * @param max — 최대 글자 수
 * @returns 잘린 문자열(잘렸으면 끝에 "…")
 */
export function clipText(text: string | null | undefined, max: number): string {
  const chars = Array.from(text ?? "");
  if (chars.length <= max) return chars.join("");
  return `${chars.slice(0, Math.max(0, max - 1)).join("")}…`;
}

/** 묶기에 필요한 신고 행 필드(엔티티 ContentReport 의 일부) */
export interface ReportRow {
  /** 신고 대상 종류 */
  targetType: string;
  /** 신고 대상 ID */
  targetId: string;
  /** 신고 사유 */
  reason: string;
  /** 상세 설명 */
  detail: string | null;
  /** 처리 상태 */
  status: string;
  /** 제목 사본 */
  snapshotTitle: string | null;
  /** 본문 사본 */
  snapshotContent: string;
  /** 작성자 닉네임 사본 */
  snapshotAuthor: string | null;
  /** 대상 화면 경로 */
  targetLink: string | null;
  /** 신고 시각 */
  createdAt: Date;
  /** 처리 시각 */
  handledAt: Date | null;
}

/** 대상 하나에 들어온 신고 묶음(관리자 화면 1줄) */
export interface ReportGroup {
  /** 신고 대상 종류 */
  targetType: string;
  /** 신고 대상 ID */
  targetId: string;
  /** 신고 건수 */
  count: number;
  /** 사유별 건수(예: { abuse: 2, spam: 1 }) */
  reasons: Record<string, number>;
  /** 신고자가 적은 상세 설명(최근 것부터, 최대 MAX_DETAILS_PER_GROUP 개) */
  details: string[];
  /** 묶음의 처리 상태(행마다 다르면 가장 최근 신고의 상태) */
  status: string;
  /** 제목 사본(가장 최근 신고 기준) */
  title: string | null;
  /** 본문 사본(가장 최근 신고 기준) */
  content: string;
  /** 작성자 닉네임 사본 */
  authorName: string | null;
  /** 대상 화면 경로 */
  link: string | null;
  /** 첫 신고 시각 */
  firstReportedAt: Date;
  /** 마지막 신고 시각 */
  lastReportedAt: Date;
  /** 처리 시각(가장 늦은 처리 시각, 대기 중이면 null) */
  handledAt: Date | null;
}

/**
 * 신고 행들을 대상(targetType + targetId)별로 묶는다.
 * 정렬: 신고가 많은 대상 먼저, 같으면 최근에 신고된 대상 먼저.
 * @param rows — 신고 행 목록(순서 무관)
 * @returns 대상별 묶음 목록
 */
export function groupReports(rows: ReportRow[]): ReportGroup[] {
  const sorted = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const map = new Map<string, ReportGroup>();
  for (const r of sorted) {
    const key = `${r.targetType}:${r.targetId}`;
    let g = map.get(key);
    if (!g) {
      // 최근 신고가 먼저 오므로 처음 만난 행이 대표(최신 사본·상태)
      g = {
        targetType: r.targetType,
        targetId: r.targetId,
        count: 0,
        reasons: {},
        details: [],
        status: r.status,
        title: r.snapshotTitle,
        content: r.snapshotContent,
        authorName: r.snapshotAuthor,
        link: r.targetLink,
        firstReportedAt: r.createdAt,
        lastReportedAt: r.createdAt,
        handledAt: r.handledAt,
      };
      map.set(key, g);
    }
    g.count += 1;
    g.reasons[r.reason] = (g.reasons[r.reason] ?? 0) + 1;
    const detail = r.detail?.trim();
    if (detail && g.details.length < MAX_DETAILS_PER_GROUP) g.details.push(detail);
    if (r.createdAt < g.firstReportedAt) g.firstReportedAt = r.createdAt;
    if (r.handledAt && (!g.handledAt || r.handledAt > g.handledAt)) g.handledAt = r.handledAt;
  }
  return [...map.values()].sort(
    (a, b) => b.count - a.count || b.lastReportedAt.getTime() - a.lastReportedAt.getTime(),
  );
}

/**
 * 처리 방법을 신고 행에 남길 처리 상태로 바꾼다.
 * @param action — 관리자 처리 방법
 * @returns 처리 상태(delete → deleted, dismiss → dismissed)
 */
export function statusForAction(action: ReportAction): ReportStatus {
  return action === "delete" ? "deleted" : "dismissed";
}

/**
 * 보관 기간이 지난 처리 기록의 기준 시각 — 이보다 먼저 처리된 신고는 지운다.
 * @param now — 지금 시각
 * @param days — 보관 기간(일, 기본 REPORT_RETENTION_DAYS)
 * @returns 기준 시각
 */
export function retentionCutoff(now: Date, days: number = REPORT_RETENTION_DAYS): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
