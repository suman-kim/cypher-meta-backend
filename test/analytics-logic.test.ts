/**
 * 관리자 통계·로그 순수 로직 단위 테스트 (DB·네트워크 불필요).
 * 실행: npm test   (= node --experimental-strip-types test/analytics-logic.test.ts, Node 22.6+)
 *
 * 검증 대상 — src/analytics/analytics-logic.ts
 *  - 한국 시간 날짜: kstDateOf · kstDayStart · recentKstDates · kstRange · fillDates · isDateString
 *  - 화면 종류 묶기: routeGroupOf · routeGroupSql
 *  - 방문 로그 필터: buildVisitLogWhere · escapeLike
 *  - 목록 커서: encodeCursor · decodeCursor
 *  - 활동 합치기: mergeActivities · previewText
 * 이 폴더는 tsconfig 의 exclude 에 있어 nest build 결과(dist)에 들어가지 않는다.
 */
import {
  addDays,
  buildVisitLogWhere,
  clampInt,
  decodeCursor,
  encodeCursor,
  escapeLike,
  fillDates,
  isDateString,
  kstDateOf,
  kstDayStart,
  kstRange,
  mergeActivities,
  OTHER_ROUTE_GROUP,
  previewText,
  recentKstDates,
  ROUTE_GROUPS,
  routeGroupOf,
  routeGroupSql,
} from "../src/analytics/analytics-logic.ts";
import type { ActivityItem } from "../src/analytics/analytics-logic.ts";

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
    console.log(`  FAIL  ${name}`, detail === undefined ? "" : JSON.stringify(detail));
  }
}

console.log("\n[숫자·날짜 형식]");
check("clampInt 범위 안", clampInt("45", 1, 120, 30) === 45);
check("clampInt 위로 넘침 → 최댓값", clampInt("999", 1, 120, 30) === 120);
check("clampInt 숫자 아님 → 기본값", clampInt("abc", 1, 120, 30) === 30);
check("clampInt 없음 → 기본값", clampInt(undefined, 1, 120, 30) === 30);
check("isDateString 정상", isDateString("2026-11-07"));
check("isDateString 없는 날짜 거부", !isDateString("2026-02-30"));
check("isDateString 형식 틀림 거부", !isDateString("2026-1-7"));

console.log("\n[한국 시간 날짜]");
// UTC 14:59 = KST 23:59 (같은 날), UTC 15:00 = KST 다음날 0시
check("UTC 14:59 → KST 같은 날", kstDateOf(new Date("2026-11-06T14:59:59Z")) === "2026-11-06");
check("UTC 15:00 → KST 다음날", kstDateOf(new Date("2026-11-06T15:00:00Z")) === "2026-11-07");
check("KST 0시 = 전날 UTC 15시", kstDayStart("2026-11-07").toISOString() === "2026-11-06T15:00:00.000Z");
check("addDays 월 넘김", addDays("2026-10-31", 1) === "2026-11-01");
check("addDays 빼기", addDays("2026-03-01", -1) === "2026-02-28");
const dates = recentKstDates(3, new Date("2026-11-06T16:00:00Z")); // KST 11/7 01:00
check("최근 3일(KST 새벽 기준 오늘 포함)", JSON.stringify(dates) === JSON.stringify(["2026-11-05", "2026-11-06", "2026-11-07"]), dates);
check("최근 1일 = 오늘만", recentKstDates(1, new Date("2026-11-07T03:00:00Z")).join() === "2026-11-07");
const r = kstRange("2026-11-07", "2026-11-05");
check("kstRange 뒤집힌 순서 바로잡음", r.from === "2026-11-05" && r.to === "2026-11-07");
check("kstRange 끝은 다음날 KST 0시(미포함)", r.end.toISOString() === "2026-11-07T15:00:00.000Z" && r.start.toISOString() === "2026-11-04T15:00:00.000Z");
const filled = fillDates(
  ["2026-11-05", "2026-11-06", "2026-11-07"],
  [{ date: "2026-11-07", n: 3 }, { date: "2026-11-05", n: 1 }],
  (x) => x.date,
  (date) => ({ date, n: 0 }),
);
check("fillDates 빈 날 0 · 순서 유지", filled.map((x) => x.n).join() === "1,0,3", filled);

console.log("\n[화면 종류 묶기]");
check("홈 '/'", routeGroupOf("/") === "home");
check("전적 /players/abc", routeGroupOf("/players/abc123") === "player");
check("검색 /search → 전적", routeGroupOf("/search") === "player");
check("매치 /matches/x → 전적", routeGroupOf("/matches/x") === "player");
check("커뮤니티 글", routeGroupOf("/community/free/uuid") === "community");
check("앞부분만 같은 다른 경로는 안 묶음(/metaverse)", routeGroupOf("/metaverse") === "etc");
check("앱 메뉴 /more", routeGroupOf("/more") === "app_menu");
check("안내 /android-beta", routeGroupOf("/android-beta") === "info");
check("모르는 경로 → 기타", routeGroupOf("/somewhere") === OTHER_ROUTE_GROUP.key);
check("종류 키가 겹치지 않음", new Set(ROUTE_GROUPS.map((g) => g.key)).size === ROUTE_GROUPS.length);
const caseSql = routeGroupSql();
check("SQL CASE 모양", caseSql.startsWith("CASE WHEN path = '/' THEN 'home'") && caseSql.endsWith("ELSE 'etc' END"), caseSql);
check("SQL 하위 경로 LIKE", caseSql.includes("path LIKE '/players/%'"));
let threw = false;
try {
  routeGroupSql("path", [{ key: "x'; drop", label: "x", prefixes: ["/a"] }]);
} catch {
  threw = true;
}
check("키에 따옴표가 있으면 SQL 을 만들지 않음", threw);
threw = false;
try {
  routeGroupSql("path", [{ key: "x", label: "x", prefixes: ["/a_%"] }]);
} catch {
  threw = true;
}
check("경로 규칙에 LIKE 특수문자(%, _)가 있으면 SQL 을 만들지 않음", threw);

console.log("\n[방문 로그 필터]");
const start = new Date("2026-11-01T15:00:00Z");
const end = new Date("2026-11-07T15:00:00Z");
const base = buildVisitLogWhere({ start, end });
check("기본: 기간 + 봇 제외", base.where === `"createdAt" >= $1 AND "createdAt" < $2 AND coalesce(device, '') <> 'bot'`, base.where);
check("기본 바인딩 2개", base.params.length === 2 && base.params[0] === start);
const full = buildVisitLogWhere({
  start,
  end,
  event: "search",
  text: "50%_off",
  device: "mobile",
  client: "app",
  visitorId: "v-1",
  includeBots: true,
});
check("모든 조건 바인딩 순서", JSON.stringify(full.params.slice(2)) === JSON.stringify(["search", "%50\\%\\_off%", "mobile", "v-1"]), full.params);
check("글자 검색은 경로·검색어 둘 다", full.where.includes(`path ILIKE $4 ESCAPE`) && full.where.includes(`coalesce("query", '') ILIKE $4`));
check("앱 조건", full.where.includes(`coalesce("userAgent", '') LIKE '%CyphersMetaApp%'`));
check("봇 포함이면 봇 조건 없음", !full.where.includes("'bot'"));
check("사용자 글자가 SQL 에 직접 들어가지 않음", !full.where.includes("50"));
const web = buildVisitLogWhere({ start, end, client: "web" }, 3);
check("웹 조건은 NOT · 바인딩 번호 시작 지정", web.where.includes(`NOT (coalesce("userAgent"`) && web.where.startsWith(`"createdAt" >= $3`));
check("escapeLike 역슬래시", escapeLike("a\\b") === "a\\\\b");

console.log("\n[목록 커서]");
const cur = { ts: "2026-11-07 03:12:45.123456", id: "1b4e28ba-2fa1-11d2-883f-0016d3cca427" };
const enc = encodeCursor(cur);
check("커서 왕복", JSON.stringify(decodeCursor(enc)) === JSON.stringify(cur), decodeCursor(enc));
check("숫자 ID 커서", decodeCursor("2026-11-07 03:12:45.000001|42")?.id === "42");
check("시각 형식 틀림 → null", decodeCursor("2026-11-07T03:12:45Z|abc") === null);
check("구분자 없음 → null", decodeCursor("2026-11-07 03:12:45.123456") === null);
check("SQL 문자 섞임 → null", decodeCursor("2026-11-07 03:12:45.123456|1' OR '1") === null);
check("문자열 아님 → null", decodeCursor(undefined) === null);

console.log("\n[활동 합치기]");
/**
 * 테스트용 활동 한 건.
 * @param type — 종류
 * @param id — ID
 * @param atKey — 시각 키
 */
function act(type: string, id: string, atKey: string): ActivityItem {
  return { type, id, at: "", atKey, title: id, detail: null, actor: null, link: null };
}
const posts = [act("post", "p3", "2026-11-07 10:00:00.000000"), act("post", "p2", "2026-11-07 08:00:00.000000"), act("post", "p1", "2026-11-06 08:00:00.000000")];
const comments = [act("comment", "c2", "2026-11-07 09:00:00.000000"), act("comment", "c1", "2026-11-06 09:00:00.000000")];
const page1 = mergeActivities([posts, comments], 3);
check("최신순으로 합침", page1.items.map((i) => i.id).join() === "p3,c2,p2", page1.items.map((i) => i.id));
check("더 있으면 다음 기준 = 마지막 항목 시각", page1.nextBefore === "2026-11-07 08:00:00.000000");
const last = mergeActivities([posts.slice(2), comments.slice(1)], 3);
check("남은 것이 한 페이지 이하면 다음 없음", last.nextBefore === null && last.items.length === 2);
const same = mergeActivities([[act("post", "a", "2026-11-07 10:00:00.000000")], [act("vote", "b", "2026-11-07 10:00:00.000000")]], 5);
check("같은 시각이면 순서가 일정(종류 역순)", same.items.map((i) => i.type).join() === "vote,post");
check("빈 목록", mergeActivities([[], []], 10).items.length === 0);
check("previewText 줄바꿈 → 공백·자르기", previewText("가나\n다라마바", 4) === "가나 다…");
check("previewText 이모지를 반으로 자르지 않음", previewText("😀😀😀", 2) === "😀😀…");
check("previewText 빈 글 → null", previewText("  \n ") === null && previewText(null) === null);

console.log(`\n결과: ${passed} 통과, ${failed} 실패`);
if (failed > 0) process.exit(1);
