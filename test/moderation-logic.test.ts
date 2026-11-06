/**
 * 신고 처리 순수 로직 단위 테스트 (DB·네트워크 불필요).
 * 실행: npm test   (= node --experimental-strip-types test/moderation-logic.test.ts, Node 22.6+)
 *
 * 검증 대상 — src/moderation/report-logic.ts
 *  - hashReporterKey : 같은 값은 같은 해시, 원래 값은 남지 않음
 *  - clipText        : 글자 수 자르기(이모지를 반으로 자르지 않음)
 *  - groupReports    : 대상별 묶음·사유 집계·대표 사본·정렬
 *  - statusForAction : 처리 방법 → 처리 상태
 * 이 폴더는 tsconfig 의 exclude 에 있어 nest build 결과(dist)에 들어가지 않는다.
 */
import {
  clipText,
  groupReports,
  hashReporterKey,
  MAX_DETAILS_PER_GROUP,
  REPORT_REASONS,
  REPORT_RETENTION_DAYS,
  retentionCutoff,
  REPORT_TARGET_TYPES,
  statusForAction,
} from "../src/moderation/report-logic.ts";
import type { ReportRow } from "../src/moderation/report-logic.ts";

/** 통과한 검사 수 */
let passed = 0;
/** 실패한 검사 수 */
let failed = 0;

/**
 * 검사 1건 결과를 기록·출력한다.
 * @param name — 검사 이름
 * @param cond — 통과 조건
 * @param detail — 실패 시 함께 보일 값
 */
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

/**
 * 테스트용 신고 행을 만든다.
 * @param targetId — 대상 ID
 * @param at — 신고 시각(ISO)
 * @param extra — 덮어쓸 필드
 * @returns 신고 행
 */
function row(targetId: string, at: string, extra: Partial<ReportRow> = {}): ReportRow {
  return {
    targetType: "post",
    targetId,
    reason: "spam",
    detail: null,
    status: "pending",
    snapshotTitle: `제목-${targetId}`,
    snapshotContent: `본문-${targetId}`,
    snapshotAuthor: "작성자",
    targetLink: `/community/free/${targetId}`,
    createdAt: new Date(at),
    handledAt: null,
    ...extra,
  };
}

console.log("\n[허용값]");
check("대상 종류 3개", REPORT_TARGET_TYPES.length === 3 && REPORT_TARGET_TYPES.includes("update_comment"));
check("사유 6개(기타 포함)", REPORT_REASONS.length === 6 && REPORT_REASONS.includes("other"));

console.log("\n[hashReporterKey]");
const h1 = hashReporterKey("abc-123-key");
check("16진수 64자", /^[0-9a-f]{64}$/.test(h1), h1);
check("같은 값 → 같은 해시", h1 === hashReporterKey("abc-123-key"));
check("앞뒤 공백 무시", h1 === hashReporterKey("  abc-123-key "));
check("다른 값 → 다른 해시", h1 !== hashReporterKey("abc-123-kez"));
check("원래 값이 들어 있지 않음", !h1.includes("abc"));

console.log("\n[clipText]");
check("짧으면 그대로", clipText("안녕", 5) === "안녕");
check("길면 자르고 … 붙임(전체 길이 = max)", clipText("가나다라마바", 4) === "가나다…", clipText("가나다라마바", 4));
check("null → 빈 문자열", clipText(null, 10) === "");
check("이모지를 반으로 자르지 않음", Array.from(clipText("😀😀😀😀", 3)).length === 3, clipText("😀😀😀😀", 3));

console.log("\n[groupReports]");
const groups = groupReports([
  row("A", "2026-11-07T01:00:00Z", { reason: "abuse", detail: "욕설" }),
  row("B", "2026-11-07T05:00:00Z"),
  row("A", "2026-11-07T03:00:00Z", { reason: "abuse", snapshotContent: "수정된 본문" }),
  row("A", "2026-11-07T02:00:00Z", { reason: "spam", detail: "  " }),
  row("C", "2026-11-07T04:00:00Z", { targetType: "comment" }),
  row("C", "2026-11-07T04:30:00Z", { targetType: "comment" }),
]);
check("대상 3묶음", groups.length === 3, groups.map((g) => g.targetId));
check("신고 많은 순 → 같으면 최근 순(A3, C2, B1)", groups.map((g) => g.targetId).join("") === "ACB", groups.map((g) => g.targetId));
const a = groups[0];
check("A 건수 3", a.count === 3, a.count);
check("A 사유 집계", a.reasons.abuse === 2 && a.reasons.spam === 1, a.reasons);
check("A 대표 사본은 가장 최근 신고", a.content === "수정된 본문", a.content);
check("빈 상세 설명은 빼고 모음", a.details.length === 1 && a.details[0] === "욕설", a.details);
check("첫·마지막 신고 시각", a.firstReportedAt.toISOString() === "2026-11-07T01:00:00.000Z" && a.lastReportedAt.toISOString() === "2026-11-07T03:00:00.000Z");
check("같은 ID 라도 종류가 다르면 다른 묶음", groupReports([row("X", "2026-11-07T01:00:00Z"), row("X", "2026-11-07T01:00:00Z", { targetType: "comment" })]).length === 2);
check("빈 목록", groupReports([]).length === 0);
const many = groupReports(
  Array.from({ length: 8 }, (_, i) => row("D", `2026-11-07T0${i}:00:00Z`, { detail: `상세${i}` })),
);
check(`상세 설명은 최대 ${MAX_DETAILS_PER_GROUP}개, 최근 것부터`, many[0].details.length === MAX_DETAILS_PER_GROUP && many[0].details[0] === "상세7", many[0].details);
const handled = groupReports([
  row("E", "2026-11-07T01:00:00Z", { status: "deleted", handledAt: new Date("2026-11-07T06:00:00Z") }),
  row("E", "2026-11-07T02:00:00Z", { status: "deleted", handledAt: new Date("2026-11-07T07:00:00Z") }),
]);
check("처리 시각은 가장 늦은 값", handled[0].handledAt?.toISOString() === "2026-11-07T07:00:00.000Z");
check("입력 배열을 바꾸지 않음", (() => {
  const input = [row("F", "2026-11-07T01:00:00Z"), row("G", "2026-11-07T02:00:00Z")];
  groupReports(input);
  return input[0].targetId === "F";
})());

console.log("\n[statusForAction]");
check("delete → deleted", statusForAction("delete") === "deleted");
check("dismiss → dismissed", statusForAction("dismiss") === "dismissed");

console.log("\n[retentionCutoff]");
check("보관 기간 365일(개인정보처리방침과 같음)", REPORT_RETENTION_DAYS === 365);
check(
  "기준 시각 = 지금 - 365일",
  retentionCutoff(new Date("2027-11-07T00:00:00Z")).toISOString() === "2026-11-07T00:00:00.000Z",
  retentionCutoff(new Date("2027-11-07T00:00:00Z")).toISOString(),
);
check("보관 기간을 바꿔 계산", retentionCutoff(new Date("2026-11-07T00:00:00Z"), 1).toISOString() === "2026-11-06T00:00:00.000Z");

console.log(`\n결과: ${passed} 통과 / ${failed} 실패`);
if (failed > 0) process.exit(1);
