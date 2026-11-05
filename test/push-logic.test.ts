/**
 * 푸시 알림 순수 로직 단위 테스트 (DB·네트워크·API 키 불필요).
 * 실행: npm test   (= node --experimental-strip-types test/push-logic.test.ts, Node 22.6+)
 *
 * 검증 대상
 *  - alert-logic.ts      : 새 방송 키 계산, 쿨다운, 새 경기 판정, 알림 문구 생성, 동시 실행 제한
 *  - subscription-diff.ts: 구독 동기화 차이 계산(유지·삭제·추가·표시명 변경)
 *  - push-message.ts     : FCM 페이로드 모양(앱과의 계약)
 * 이 폴더는 tsconfig 의 exclude 에 있어 nest build 결과(dist)에 들어가지 않는다.
 */
import {
  buildLiveMessage,
  buildMatchMessage,
  computeLiveTransition,
  decideMatchAlert,
  filterCooldown,
  LIVE_COOLDOWN_MS,
  liveKey,
  mapWithConcurrency,
  platformOfLiveKey,
  pruneCooldown,
} from "../src/push/alerts/alert-logic.ts";
import type { MatchSummary } from "../src/push/alerts/alert-logic.ts";
import { diffSubscriptions } from "../src/push/subscription-diff.ts";
import { buildFcmPayload } from "../src/push/push-message.ts";

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
 * 두 값이 JSON 으로 같은지 비교한다.
 * @param a — 실제 값
 * @param b — 기대 값
 * @returns 같으면 true
 */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 테스트용 경기 요약을 만든다.
 * @param id — 매치 ID
 * @param playedAt — 경기 시각(ISO)
 * @param extra — 덮어쓸 필드
 * @returns 경기 요약
 */
function match(id: string, playedAt: string, extra: Partial<MatchSummary> = {}): MatchSummary {
  return {
    matchId: id,
    gameType: "rating",
    playedAt: new Date(playedAt),
    result: "win",
    characterName: "다이무스",
    kill: 5,
    death: 2,
    assist: 7,
    ...extra,
  };
}

console.log("▶ 방송 시작 — 새 라이브 키 계산(computeLiveTransition)");
{
  const s = (...keys: string[]) => new Set(keys);
  // 첫 틱: 기준점만
  const t1 = computeLiveTransition(new Map(), new Map([["chzzk", s("chzzk:a", "chzzk:b")]]));
  check("첫 틱은 알리지 않음", t1.started.length === 0, t1.started);
  check("첫 틱 스냅샷 저장", same([...(t1.next.get("chzzk") ?? [])], ["chzzk:a", "chzzk:b"]));

  // 둘째 틱: c 새로 시작, a 종료
  const t2 = computeLiveTransition(t1.next, new Map([["chzzk", s("chzzk:b", "chzzk:c")]]));
  check("새로 나타난 키만 started", same(t2.started, ["chzzk:c"]), t2.started);

  // 조회 실패(null) → 직전 값 유지, 알림 없음
  const t3 = computeLiveTransition(t2.next, new Map([["chzzk", null]]));
  check("실패 시 알림 없음", t3.started.length === 0);
  check("실패 시 직전 스냅샷 유지", same([...(t3.next.get("chzzk") ?? [])], ["chzzk:b", "chzzk:c"]));

  // 복구: 직전(b,c) 대비 d 만 새 방송
  const t4 = computeLiveTransition(t3.next, new Map([["chzzk", s("chzzk:b", "chzzk:c", "chzzk:d")]]));
  check("복구 순간 전부가 아니라 진짜 새 방송만", same(t4.started, ["chzzk:d"]), t4.started);

  // 처음 조회하는 플랫폼(youtube)은 기준점만, 기존 플랫폼은 정상 비교
  const t5 = computeLiveTransition(
    t4.next,
    new Map([
      ["chzzk", s("chzzk:b", "chzzk:c", "chzzk:d", "chzzk:e")],
      ["youtube", s("youtube:x")],
    ]),
  );
  check("새 플랫폼은 기준점만, 기존 플랫폼은 비교", same(t5.started, ["chzzk:e"]), t5.started);

  // 조회하지 않은 플랫폼(구독자 없음)은 스냅샷에서 빠짐
  const t6 = computeLiveTransition(t5.next, new Map([["chzzk", s("chzzk:b")]]));
  check("조회 안 한 플랫폼은 스냅샷에서 제거", !t6.next.has("youtube"));

  // 첫 조회부터 실패한 플랫폼은 스냅샷에 생기지 않음(다음 성공 때 기준점)
  const t7 = computeLiveTransition(new Map(), new Map([["youtube", null]]));
  check("첫 조회 실패 → 스냅샷 없음", !t7.next.has("youtube"));

  check("liveKey 형식", liveKey("chzzk", "abc") === "chzzk:abc");
  check("platformOfLiveKey", platformOfLiveKey("youtube:UC1:x") === "youtube");
}

console.log("▶ 방송 시작 — 30분 쿨다운");
{
  const now = 10_000_000;
  const last = new Map<string, number>([
    ["chzzk:a", now - 5 * 60 * 1000], // 5분 전 알림 → 쿨다운 중
    ["chzzk:b", now - LIVE_COOLDOWN_MS], // 정확히 30분 전 → 다시 알림 가능
  ]);
  const keys = filterCooldown(["chzzk:a", "chzzk:b", "chzzk:c"], last, now, LIVE_COOLDOWN_MS);
  check("쿨다운 중인 채널 제외", same(keys, ["chzzk:b", "chzzk:c"]), keys);
  pruneCooldown(last, now, LIVE_COOLDOWN_MS);
  check("끝난 쿨다운 기록 정리", same([...last.keys()], ["chzzk:a"]), [...last.keys()]);
}

console.log("▶ 방송 시작 — 알림 문구");
{
  const m = buildLiveMessage({ channelName: "홍길동", title: "다이아 가는 날", url: "https://chzzk.naver.com/live/abc" });
  check("제목 '{채널명} 방송 시작'", m.title === "홍길동 방송 시작", m);
  check("본문 = 방송 제목", m.body === "다이아 가는 날");
  check("kind live / url 그대로", m.kind === "live" && m.url === "https://chzzk.naver.com/live/abc");
  const empty = buildLiveMessage({ channelName: "", title: "  ", url: "https://x" }, "저장된이름");
  check("제목 없으면 기본 본문", empty.body === "지금 사이퍼즈 방송 중", empty);
  check("채널명 없으면 구독 표시명", empty.title === "저장된이름 방송 시작", empty);
}

console.log("▶ 전적 갱신 — 새 경기 판정(decideMatchAlert)");
{
  const now = new Date("2026-11-06T12:00:00+09:00");
  const ms = [
    match("m3", "2026-11-06T11:30:00+09:00"),
    match("m2", "2026-11-06T10:50:00+09:00", { gameType: "normal", result: "lose" }),
    match("m1", "2026-11-06T03:00:00+09:00"), // 9시간 전
  ];

  const base = decideMatchAlert(null, ms, now);
  check("기준점 없음 → baseline, 알림 없음", base.baseline && base.newMatches.length === 0);
  check("기준점 = 가장 최근 경기 시각", base.nextLastEventAt?.toISOString() === ms[0].playedAt.toISOString());

  const empty = decideMatchAlert(null, [], now);
  check("경기가 없으면 기준점 = now", empty.nextLastEventAt?.getTime() === now.getTime());

  const none = decideMatchAlert(new Date("2026-11-06T11:30:00+09:00"), ms, now);
  check("새 경기 없음 → 알림·갱신 없음", none.newMatches.length === 0 && none.nextLastEventAt === null, none);

  const two = decideMatchAlert(new Date("2026-11-06T10:00:00+09:00"), ms, now);
  check("기준 이후 경기 2판(최신순)", same(two.newMatches.map((m) => m.matchId), ["m3", "m2"]), two.newMatches);
  check("lastEventAt = 최신 경기 시각", two.nextLastEventAt?.toISOString() === ms[0].playedAt.toISOString());

  const stale = decideMatchAlert(new Date("2026-11-06T01:00:00+09:00"), [ms[2]], now);
  check("6시간 지난 경기는 알리지 않음", stale.newMatches.length === 0, stale);
  check("그래도 lastEventAt 은 올림(다시 보지 않게)", stale.nextLastEventAt?.toISOString() === ms[2].playedAt.toISOString());

  const dup = decideMatchAlert(new Date("2026-11-06T11:00:00+09:00"), [ms[0], ms[0]], now);
  check("같은 matchId 중복 제거", dup.newMatches.length === 1);

  const equal = decideMatchAlert(new Date("2026-11-06T11:30:00+09:00"), [ms[0]], now);
  check("기준과 같은 시각은 새 경기 아님", equal.newMatches.length === 0);
}

console.log("▶ 전적 갱신 — 알림 문구");
{
  const pid = "0123456789abcdef0123456789abcdef";
  const one = buildMatchMessage("닉네임", pid, [match("m9", "2026-11-06T11:30:00+09:00")]);
  check("1판 제목", one.title === "닉네임 새 공식전 기록", one);
  check("1판 본문", one.body === "승리 · 다이무스 · 5/2/7", one);
  check("1판 주소", one.url === `/matches/m9?highlight=${pid}`, one);
  check("kind match", one.kind === "match");

  const lose = buildMatchMessage("닉", pid, [match("m8", "2026-11-06T11:30:00+09:00", { gameType: "normal", result: "lose", characterName: "로라스" })]);
  check("일반전·패배 문구", lose.title === "닉 새 일반전 기록" && lose.body === "패배 · 로라스 · 5/2/7", lose);

  const many = buildMatchMessage("닉네임", pid, [
    match("a", "2026-11-06T11:30:00+09:00", { characterName: "트릭시" }),
    match("b", "2026-11-06T11:00:00+09:00", { result: "lose" }),
    match("c", "2026-11-06T10:30:00+09:00"),
  ]);
  check("여러 판 제목", many.title === "닉네임 새 경기 3판", many);
  check("여러 판 본문(승패·최근 캐릭터)", many.body === "2승 1패 · 최근 트릭시", many);
  check("여러 판 주소", many.url === `/players/${pid}`, many);

  const noName = buildMatchMessage(null, pid, [match("m9", "2026-11-06T11:30:00+09:00")]);
  check("닉네임 없으면 기본 이름", noName.title.startsWith("구독한 플레이어 "), noName);
}

console.log("▶ 구독 동기화 차이(diffSubscriptions)");
{
  const existing = [
    { id: "1", kind: "player", targetId: "p1", label: "옛닉" },
    { id: "2", kind: "player", targetId: "p2", label: "닉2" },
    { id: "3", kind: "live", targetId: "chzzk:c1", label: "채널1" },
  ];
  const d = diffSubscriptions(existing, [
    { kind: "player", targetId: "p1", label: "새닉" }, // 유지 + 표시명 변경
    { kind: "live", targetId: "chzzk:c1", label: "채널1" }, // 유지(변경 없음)
    { kind: "live", targetId: "youtube:y1", label: "유튜버" }, // 추가
    { kind: "live", targetId: "youtube:y1", label: "유튜버" }, // 중복
  ]);
  check("빠진 것 삭제(p2)", same(d.toDelete, ["2"]), d.toDelete);
  check("표시명만 변경(p1)", same(d.toRelabel, [{ id: "1", label: "새닉" }]), d.toRelabel);
  check("새것만 추가(y1, 중복 1번)", same(d.toInsert.map((x) => x.targetId), ["youtube:y1"]), d.toInsert);
  check("최종 개수(중복 제거)", d.desired.length === 3);
  const clear = diffSubscriptions(existing, []);
  check("빈 목록 → 전부 삭제", same(clear.toDelete, ["1", "2", "3"]) && clear.toInsert.length === 0);
}

console.log("▶ FCM 페이로드(앱과의 계약)");
{
  const live = buildFcmPayload({ kind: "live", title: "T", body: "B", url: "https://x" });
  check(
    "live: 채널 live·아이콘·우선순위·data",
    same(live, {
      notification: { title: "T", body: "B" },
      data: { kind: "live", url: "https://x" },
      android: { priority: "high", notification: { channelId: "live", icon: "ic_stat_notify" } },
    }),
    live,
  );
  const test = buildFcmPayload({ kind: "test", title: "T", body: "B", url: "/notifications" });
  check("test 알림은 match 채널", test.android.notification.channelId === "match" && test.data.kind === "test", test);
  const m = buildFcmPayload({ kind: "match", title: "T", body: "B", url: "/players/x" });
  check("match 알림은 match 채널", m.android.notification.channelId === "match");
}

console.log("▶ 동시 실행 제한(mapWithConcurrency)");
{
  let active = 0;
  let peak = 0;
  const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4, async (n) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return n * 2;
  });
  check("동시에 최대 4개", peak === 4, peak);
  check("결과 순서 유지", same(out, [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]), out);
  check("빈 목록", same(await mapWithConcurrency([], 4, async (n) => n), []));
}

console.log(`\n결과: ${passed} 통과 / ${failed} 실패`);
if (failed > 0) process.exit(1);
