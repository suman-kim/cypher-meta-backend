/**
 * analytics-logic.ts — 관리자 통계·로그 화면이 쓰는 순수 로직 (DB·Nest 의존 없음, 단위 테스트 대상).
 *
 * - 한국 시간(KST) 기준 날짜 계산: 하루 시작 시각, 최근 N일 날짜 목록, 빈 날 채우기
 * - 화면 종류 묶기: 경로(/players/abc …)를 화면 종류(전적·커뮤니티 …)로 묶는 규칙과 그 SQL
 * - 방문 로그 필터: 관리자가 고른 조건을 파라미터 바인딩 SQL 조건으로 바꾸기
 * - 목록 커서: (시각·ID) 키셋 페이지 넘김용 커서 만들기/읽기
 * - 활동 합치기: 여러 출처의 최신순 목록을 하나로 합쳐 한 페이지 자르기
 *
 * 테스트: test/analytics-logic.test.ts (npm test)
 */

/** 통계 기준 시간대 */
export const KST_ZONE = "Asia/Seoul";
/** KST 와 UTC 의 차이(밀리초). 한국은 서머타임이 없어 고정값이다. */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** 하루(밀리초) */
export const DAY_MS = 24 * 60 * 60 * 1000;
/** 앱 셸이 User-Agent 끝에 붙이는 식별 문자열 — 앱/웹 구분에 쓴다 */
export const APP_UA_MARK = "CyphersMetaApp";
/** 검색 로봇으로 판정된 기기 유형 값(visits.device) */
export const BOT_DEVICE = "bot";
/** 일별 표에서 고를 수 있는 최대 기간(일) */
export const MAX_DAILY_DAYS = 120;
/** 방문 로그 한 페이지 최대 건수 */
export const MAX_LOG_LIMIT = 100;
/** '조회수'로 세는 이벤트 — 화면을 연 기록(전적 검색 화면은 search 로 남는다). 버튼 클릭·공지 노출 같은 기타 이벤트는 빼고 센다. */
export const VIEW_EVENTS = ["pageview", "search"] as const;
/** VIEW_EVENTS 를 SQL IN 목록으로 쓴 것 */
export const VIEW_EVENTS_SQL = VIEW_EVENTS.map((e) => `'${e}'`).join(", ");
/** 방문 로그에서 고를 수 있는 기기 유형 */
export const LOG_DEVICES = ["desktop", "mobile", "tablet"] as const;
/** 앱/웹 구분 값 */
export const CLIENT_KINDS = ["app", "web"] as const;
/** 앱/웹 구분 값 타입 */
export type ClientKind = (typeof CLIENT_KINDS)[number];

/* ───────────── 숫자·날짜 ───────────── */

/**
 * 숫자 입력을 정수로 바꾸고 범위 안으로 맞춘다.
 * @param value — 원래 값(문자열·숫자·없음)
 * @param min — 최솟값
 * @param max — 최댓값
 * @param fallback — 숫자가 아닐 때 쓸 값
 * @returns 범위 안의 정수
 */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * 'YYYY-MM-DD' 형식이고 실제로 있는 날짜인지 확인한다.
 * @param s — 확인할 문자열
 * @returns 올바른 날짜면 true
 */
export function isDateString(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * 어떤 순간이 한국 시간으로 며칠인지 돌려준다.
 * @param at — 순간
 * @returns 'YYYY-MM-DD' (KST)
 */
export function kstDateOf(at: Date): string {
  return new Date(at.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 한국 시간 날짜의 0시가 어떤 순간인지 돌려준다.
 * @param date — 'YYYY-MM-DD' (KST)
 * @returns 그날 KST 0시의 순간(UTC 로는 전날 15시)
 */
export function kstDayStart(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) - KST_OFFSET_MS);
}

/**
 * 날짜에 며칠을 더한다(빼려면 음수).
 * @param date — 'YYYY-MM-DD'
 * @param days — 더할 일수
 * @returns 'YYYY-MM-DD'
 */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * 오늘(KST)을 끝으로 하는 최근 N일의 날짜 목록을 오래된 순으로 돌려준다.
 * @param days — 일수(1 이상)
 * @param now — 기준 순간(테스트용, 기본 지금)
 * @returns ['YYYY-MM-DD', …] 길이 days
 */
export function recentKstDates(days: number, now: Date = new Date()): string[] {
  const today = kstDateOf(now);
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(addDays(today, -i));
  return out;
}

/**
 * 날짜별 행 목록에 빠진 날을 채워 날짜 목록 순서대로 돌려준다.
 * @param dates — 보여 줄 날짜 목록(순서 유지)
 * @param rows — DB 에서 읽은 행(날짜가 없는 날은 빠져 있음)
 * @param dateOf — 행에서 날짜를 꺼내는 함수
 * @param empty — 빈 날의 행을 만드는 함수
 * @returns dates 와 같은 길이·순서의 행 목록
 */
export function fillDates<T>(
  dates: string[],
  rows: T[],
  dateOf: (row: T) => string,
  empty: (date: string) => T,
): T[] {
  const map = new Map(rows.map((r) => [dateOf(r), r]));
  return dates.map((d) => map.get(d) ?? empty(d));
}

/**
 * 시작~끝 날짜(KST)를 순간 범위 [시작 0시, 끝 다음날 0시)로 바꾼다. 순서가 뒤집혀 있으면 바로잡는다.
 * @param from — 시작 날짜 'YYYY-MM-DD'
 * @param to — 끝 날짜 'YYYY-MM-DD'
 * @returns { from, to: 바로잡은 날짜, start, end: 순간 }
 */
export function kstRange(from: string, to: string): { from: string; to: string; start: Date; end: Date } {
  const [a, b] = from <= to ? [from, to] : [to, from];
  return { from: a, to: b, start: kstDayStart(a), end: kstDayStart(addDays(b, 1)) };
}

/* ───────────── 화면 종류 묶기 ───────────── */

/** 화면 종류 하나 — 경로 앞부분으로 판정한다 */
export interface RouteGroup {
  /** 종류 키(응답·표의 열 이름) */
  key: string;
  /** 관리자 화면에 보일 이름 */
  label: string;
  /** 정확히 같으면 이 종류인 경로 */
  exact?: string[];
  /** 이 경로 자체이거나 그 아래('/x/…')면 이 종류인 경로 앞부분 */
  prefixes?: string[];
}

/** 화면 종류 목록(위에서부터 먼저 맞는 것). 새 화면이 생기면 여기에 한 줄 더한다. */
export const ROUTE_GROUPS: RouteGroup[] = [
  { key: "home", label: "홈", exact: ["/"] },
  { key: "player", label: "전적", prefixes: ["/players", "/search", "/matches"] },
  { key: "character", label: "캐릭터·아이템", prefixes: ["/characters", "/items"] },
  { key: "meta", label: "메타", prefixes: ["/meta"] },
  { key: "ranking", label: "랭킹", prefixes: ["/ranking"] },
  { key: "community", label: "커뮤니티", prefixes: ["/community"] },
  { key: "costume", label: "코스튬", prefixes: ["/costumes"] },
  { key: "update", label: "업데이트", prefixes: ["/updates"] },
  { key: "video", label: "영상", prefixes: ["/videos"] },
  { key: "app_menu", label: "앱 메뉴", prefixes: ["/more", "/notifications", "/account"] },
  { key: "info", label: "안내·약관", prefixes: ["/android-beta", "/terms", "/privacy", "/business-info"] },
];
/** 어느 종류에도 맞지 않는 경로의 종류 */
export const OTHER_ROUTE_GROUP: RouteGroup = { key: "etc", label: "기타" };

/**
 * 경로가 어떤 화면 종류인지 돌려준다(SQL 의 routeGroupSql 과 같은 규칙).
 * @param path — 방문 경로(쿼리 없는 path)
 * @param groups — 종류 목록(기본 ROUTE_GROUPS)
 * @returns 종류 키
 */
export function routeGroupOf(path: string, groups: RouteGroup[] = ROUTE_GROUPS): string {
  for (const g of groups) {
    if (g.exact?.includes(path)) return g.key;
    if (g.prefixes?.some((p) => path === p || path.startsWith(`${p}/`))) return g.key;
  }
  return OTHER_ROUTE_GROUP.key;
}

/**
 * 경로 → 화면 종류 키를 만드는 SQL CASE 식을 만든다. 코드에 적힌 상수만 쓰고 사용자 입력은 넣지 않는다.
 * @param column — 경로 컬럼 식(기본 "path")
 * @param groups — 종류 목록(기본 ROUTE_GROUPS)
 * @returns CASE … END 식
 */
export function routeGroupSql(column = "path", groups: RouteGroup[] = ROUTE_GROUPS): string {
  // 경로 규칙은 영문·숫자·'/'·'-'만(LIKE 의 %, _ 와 따옴표가 섞이지 않게), 종류 키는 영문 소문자·'_'만 허용
  const path = (s: string) => {
    if (!/^[a-z0-9/-]*$/i.test(s)) throw new Error(`화면 종류 경로 규칙에 쓸 수 없는 문자: ${s}`);
    return s;
  };
  const key = (s: string) => {
    if (!/^[a-z_]+$/.test(s)) throw new Error(`화면 종류 키에 쓸 수 없는 문자: ${s}`);
    return `'${s}'`;
  };
  const whens = groups.map((g) => {
    const conds = [
      ...(g.exact ?? []).map((e) => `${column} = '${path(e)}'`),
      ...(g.prefixes ?? []).flatMap((p) => [`${column} = '${path(p)}'`, `${column} LIKE '${path(p)}/%'`]),
    ];
    return `WHEN ${conds.join(" OR ")} THEN ${key(g.key)}`;
  });
  return `CASE ${whens.join(" ")} ELSE ${key(OTHER_ROUTE_GROUP.key)} END`;
}

/* ───────────── 방문 로그 필터 ───────────── */

/** 방문 로그 필터(이미 검증·정리된 값) */
export interface VisitLogFilter {
  /** 이 순간 이후(포함) */
  start: Date;
  /** 이 순간 이전(미포함) */
  end: Date;
  /** 이벤트 이름(정확히 일치). 없으면 전체 */
  event?: string;
  /** 경로 또는 검색어에 들어 있는 글자. 없으면 전체 */
  text?: string;
  /** 기기 유형. 없으면 전체 */
  device?: string;
  /** 앱/웹. 없으면 전체 */
  client?: ClientKind;
  /** 방문자 ID(정확히 일치). 없으면 전체 */
  visitorId?: string;
  /** 검색 로봇 포함 여부(기본 제외) */
  includeBots?: boolean;
}

/** SQL 조건과 바인딩 값 */
export interface SqlWhere {
  /** WHERE 뒤에 붙일 조건식(AND 로 이음) */
  where: string;
  /** $1, $2 … 에 들어갈 값 */
  params: unknown[];
}

/**
 * LIKE 패턴에서 특별한 뜻을 가진 문자(%, _, \)를 글자 그대로 찾도록 바꾼다.
 * @param s — 사용자가 입력한 글자
 * @returns 이스케이프한 글자
 */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * 앱/웹 판정 SQL 식(앱이면 true).
 * @param column — User-Agent 컬럼 식
 * @returns boolean SQL 식
 */
export function appClientSql(column = `"userAgent"`): string {
  return `coalesce(${column}, '') LIKE '%${APP_UA_MARK}%'`;
}

/**
 * 봇 제외 SQL 식.
 * @param column — 기기 유형 컬럼 식
 * @returns boolean SQL 식
 */
export function notBotSql(column = "device"): string {
  return `coalesce(${column}, '') <> '${BOT_DEVICE}'`;
}

/**
 * 방문 로그 필터를 파라미터 바인딩 SQL 조건으로 바꾼다.
 * @param f — 필터
 * @param firstIndex — 첫 바인딩 번호(기본 1)
 * @returns 조건식과 값
 */
export function buildVisitLogWhere(f: VisitLogFilter, firstIndex = 1): SqlWhere {
  const conds: string[] = [];
  const params: unknown[] = [];
  const bind = (v: unknown) => {
    params.push(v);
    return `$${firstIndex + params.length - 1}`;
  };
  conds.push(`"createdAt" >= ${bind(f.start)}`);
  conds.push(`"createdAt" < ${bind(f.end)}`);
  if (f.event) conds.push(`event = ${bind(f.event)}`);
  if (f.text) {
    const p = bind(`%${escapeLike(f.text)}%`);
    conds.push(`(path ILIKE ${p} ESCAPE '\\' OR coalesce("query", '') ILIKE ${p} ESCAPE '\\')`);
  }
  if (f.device) conds.push(`device = ${bind(f.device)}`);
  if (f.client === "app") conds.push(appClientSql());
  if (f.client === "web") conds.push(`NOT (${appClientSql()})`);
  if (f.visitorId) conds.push(`"visitorId" = ${bind(f.visitorId)}`);
  if (!f.includeBots) conds.push(notBotSql());
  return { where: conds.join(" AND "), params };
}

/* ───────────── 목록 커서 ───────────── */

/** 커서 안의 시각 형식: 'YYYY-MM-DD HH:MM:SS.ffffff' (UTC, 마이크로초까지) */
const CURSOR_TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/;
/** 커서 안의 ID 형식(UUID 또는 숫자 ID) */
const CURSOR_ID = /^[0-9A-Za-z-]{1,64}$/;

/** 키셋 페이지 넘김 위치(이 행보다 오래된 것부터) */
export interface ListCursor {
  /** 마지막 행의 시각(UTC, 마이크로초까지 문자열) */
  ts: string;
  /** 마지막 행의 ID(같은 시각끼리 순서를 정함) */
  id: string;
}

/**
 * 커서를 URL 에 넣을 문자열로 만든다.
 * @param c — 커서
 * @returns 'ts|id'
 */
export function encodeCursor(c: ListCursor): string {
  return `${c.ts}|${c.id}`;
}

/**
 * 커서 문자열을 읽는다. 형식이 틀리면 null.
 * @param s — 'ts|id'
 * @returns 커서 또는 null
 */
export function decodeCursor(s: unknown): ListCursor | null {
  if (typeof s !== "string") return null;
  const i = s.lastIndexOf("|");
  if (i < 0) return null;
  const ts = s.slice(0, i);
  const id = s.slice(i + 1);
  return CURSOR_TS.test(ts) && CURSOR_ID.test(id) ? { ts, id } : null;
}

/**
 * 시각 컬럼을 커서용 문자열로 바꾸는 SQL 식.
 * @param column — timestamptz 컬럼 식
 * @returns text SQL 식
 */
export function cursorTsSql(column: string): string {
  return `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')`;
}

/* ───────────── 활동 합치기 ───────────── */

/** 활동 한 건(출처와 상관없이 같은 모양) */
export interface ActivityItem {
  /** 활동 종류 키(post, comment …) */
  type: string;
  /** 원래 행의 ID */
  id: string;
  /** 일어난 순간(ISO) */
  at: string;
  /** 정렬·커서용 시각(UTC, 마이크로초까지) */
  atKey: string;
  /** 한 줄 제목 */
  title: string;
  /** 부가 설명(내용 앞부분 등). 없으면 null */
  detail: string | null;
  /** 한 사람(닉네임 등). 없으면 null */
  actor: string | null;
  /** 눌렀을 때 갈 사이트 경로. 없으면 null */
  link: string | null;
}

/**
 * 두 활동의 최신순 비교(시각 → 종류 → ID).
 * @param a — 활동 A
 * @param b — 활동 B
 * @returns 음수면 a 가 더 최근
 */
export function compareActivityDesc(a: ActivityItem, b: ActivityItem): number {
  if (a.atKey !== b.atKey) return a.atKey < b.atKey ? 1 : -1;
  if (a.type !== b.type) return a.type < b.type ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * 출처별 최신순 목록(각각 limit+1 건까지)을 하나로 합쳐 한 페이지를 자른다.
 * 각 출처가 limit+1 건씩 주면 합친 뒤 위 limit+1 건은 전체 기준으로도 정확하다.
 * 다음 페이지는 "nextBefore 보다 이전"으로 읽으므로, 마지막 항목과 마이크로초까지 같은 시각의 다른 항목은
 * 건너뛸 수 있다(서로 다른 테이블에서 같은 마이크로초에 생길 일은 사실상 없어 받아들인다).
 * @param lists — 출처별 목록
 * @param limit — 한 페이지 건수
 * @returns { items: 이번 페이지, nextBefore: 다음 페이지 기준 시각(없으면 null) }
 */
export function mergeActivities(
  lists: ActivityItem[][],
  limit: number,
): { items: ActivityItem[]; nextBefore: string | null } {
  const all = lists.flat().sort(compareActivityDesc);
  const items = all.slice(0, limit);
  const nextBefore = all.length > limit && items.length > 0 ? items[items.length - 1].atKey : null;
  return { items, nextBefore };
}

/**
 * 글자를 앞에서부터 잘라 한 줄 미리보기로 만든다(줄바꿈은 공백으로).
 * @param text — 원래 글
 * @param max — 최대 글자 수(이모지를 반으로 자르지 않도록 코드포인트 기준)
 * @returns 자른 글(잘렸으면 끝에 …). 비어 있으면 null
 */
export function previewText(text: string | null | undefined, max = 80): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  const chars = [...flat];
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : flat;
}
