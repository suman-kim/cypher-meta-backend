/**
 * analytics-report.service.ts — 관리자 '일별'·'방문 로그' 화면용 조회 서비스.
 *
 * - daily  : 최근 N일 날짜별 조회수·방문자·새 방문자·검색·앱/웹 + 화면 종류별 조회수
 * - day    : 하루(KST) 상세 — 페이지·검색어·유입·시간대·이벤트·화면 종류
 * - logs   : 방문 로그 필터 조회(키셋 커서로 '더 보기')
 * - visitor: 방문자 한 명 요약(첫·마지막 방문, 조회 수, 앱/웹, 자주 본 화면)
 *
 * 날짜는 모두 한국 시간 자정 기준이고, 검색 로봇(device=bot)은 기본으로 뺀다.
 * 사용자가 고른 값은 모두 SQL 파라미터로 넘기고, SQL 에 직접 넣는 것은 코드의 상수뿐이다.
 */
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Visit } from "../database/entities";
import {
  addDays,
  appClientSql,
  buildVisitLogWhere,
  clampInt,
  cursorTsSql,
  decodeCursor,
  encodeCursor,
  fillDates,
  isDateString,
  kstDateOf,
  kstDayStart,
  kstRange,
  KST_ZONE,
  MAX_DAILY_DAYS,
  MAX_LOG_LIMIT,
  notBotSql,
  OTHER_ROUTE_GROUP,
  recentKstDates,
  ROUTE_GROUPS,
  routeGroupSql,
  VIEW_EVENTS_SQL,
} from "./analytics-logic";
import { LogsQuery } from "./dto";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 한국 시간 날짜 문자열 SQL 식 */
const KST_DATE = `to_char(("createdAt" AT TIME ZONE '${KST_ZONE}')::date, 'YYYY-MM-DD')`;
/** UUID 형식(방문 로그 행 ID) */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 실제로 있는 날짜인지 확인한다(DTO 는 형식만 본다 — 2026-13-01 같은 값을 여기서 막는다).
 * @param date — 'YYYY-MM-DD'
 * @param label — 오류 문구에 쓸 이름(예: "시작 날짜")
 * @throws BadRequestException 없는 날짜면
 */
function assertDate(date: string, label: string): void {
  if (!isDateString(date)) throw new BadRequestException(`${label}가 올바른 날짜가 아닙니다.`);
}

/** 일별 표 한 줄 */
export interface DailyRow {
  /** 날짜 'YYYY-MM-DD' (KST) */
  date: string;
  /** 조회수(화면을 연 횟수: pageview + search) */
  views: number;
  /** 방문자 수(쿠키 기준 순 방문자) */
  visitors: number;
  /** 새 방문자 수(그날 처음 온 방문자) */
  newVisitors: number;
  /** 전적 검색 수 */
  searches: number;
  /** 앱에서 본 조회수 */
  appViews: number;
  /** 웹에서 본 조회수 */
  webViews: number;
  /** 기타 이벤트 수(버튼 클릭·공지 노출 등) */
  otherEvents: number;
  /** 화면 종류별 조회수(키 → 수) */
  byGroup: Record<string, number>;
}

/** 관리자 일별·방문 로그 조회 서비스 */
@Injectable()
export class AnalyticsReportService {
  /**
   * @param repo — 방문 기록 리포지토리(원시 SQL 실행용)
   */
  constructor(@InjectRepository(Visit) private readonly repo: Repository<Visit>) {}

  /** @returns 화면 종류 안내 목록(키·이름, 표의 열 순서) */
  private groupInfo(): { key: string; label: string }[] {
    return [...ROUTE_GROUPS, OTHER_ROUTE_GROUP].map(({ key, label }) => ({ key, label }));
  }

  /**
   * 최근 N일 날짜별 표를 만든다.
   * @param daysInput — 일수(1~120, 기본 30, 오늘 포함)
   * @returns { range, groups: 화면 종류 안내, rows: 날짜별 줄(오래된 순, 빈 날은 0) }
   */
  async daily(daysInput?: string) {
    const days = clampInt(daysInput, 1, MAX_DAILY_DAYS, 30);
    const dates = recentKstDates(days);
    const start = kstDayStart(dates[0]);

    const [base, fresh, groups] = await Promise.all([
      this.repo.query(
        `SELECT ${KST_DATE} AS date,
                count(*) FILTER (WHERE event IN (${VIEW_EVENTS_SQL}))::int AS views,
                count(DISTINCT "visitorId")::int AS visitors,
                count(*) FILTER (WHERE event = 'search')::int AS searches,
                count(*) FILTER (WHERE event IN (${VIEW_EVENTS_SQL}) AND ${appClientSql()})::int AS "appViews",
                count(*) FILTER (WHERE event NOT IN (${VIEW_EVENTS_SQL}))::int AS "otherEvents"
         FROM visits WHERE "createdAt" >= $1 AND ${notBotSql()}
         GROUP BY 1`,
        [start],
      ),
      // 새 방문자: 기간 안 첫 방문 날짜를 세되, 기간 전에 온 적이 있으면 뺀다(방문자 ID 색인 사용)
      this.repo.query(
        `SELECT to_char((r.first AT TIME ZONE '${KST_ZONE}')::date, 'YYYY-MM-DD') AS date, count(*)::int AS "newVisitors"
         FROM (
           SELECT "visitorId", min("createdAt") AS first FROM visits
           WHERE "createdAt" >= $1 AND "visitorId" <> 'unknown' AND ${notBotSql()}
           GROUP BY "visitorId"
         ) r
         WHERE NOT EXISTS (SELECT 1 FROM visits p WHERE p."visitorId" = r."visitorId" AND p."createdAt" < $1)
         GROUP BY 1`,
        [start],
      ),
      this.repo.query(
        `SELECT ${KST_DATE} AS date, ${routeGroupSql()} AS grp, count(*)::int AS views
         FROM visits WHERE "createdAt" >= $1 AND event IN (${VIEW_EVENTS_SQL}) AND ${notBotSql()}
         GROUP BY 1, 2`,
        [start],
      ),
    ]);

    const freshMap = new Map<string, number>(fresh.map((r: any) => [r.date, r.newVisitors]));
    const groupMap = new Map<string, Record<string, number>>();
    for (const g of groups as { date: string; grp: string; views: number }[]) {
      const m = groupMap.get(g.date) ?? {};
      m[g.grp] = g.views;
      groupMap.set(g.date, m);
    }
    const emptyGroups = () => Object.fromEntries(this.groupInfo().map((g) => [g.key, 0]));

    const rows: DailyRow[] = fillDates(
      dates,
      base as any[],
      (r) => r.date,
      (date) => ({ date, views: 0, visitors: 0, searches: 0, appViews: 0, otherEvents: 0 }),
    ).map((r) => ({
      date: r.date,
      views: r.views,
      visitors: r.visitors,
      newVisitors: freshMap.get(r.date) ?? 0,
      searches: r.searches,
      appViews: r.appViews,
      webViews: r.views - r.appViews,
      otherEvents: r.otherEvents,
      byGroup: { ...emptyGroups(), ...(groupMap.get(r.date) ?? {}) },
    }));

    return { range: { days, from: dates[0], to: dates[dates.length - 1] }, groups: this.groupInfo(), rows };
  }

  /**
   * 하루(KST) 상세를 만든다.
   * @param date — 'YYYY-MM-DD' (KST)
   * @returns 그날 합계·페이지·검색어·유입·시간대·이벤트·화면 종류
   * @throws BadRequestException 없는 날짜면
   */
  async day(date: string) {
    assertDate(date, "날짜");
    const { start, end } = kstRange(date, date);
    const w = `"createdAt" >= $1 AND "createdAt" < $2 AND ${notBotSql()}`;
    const p = [start, end];
    const [totals, pages, searches, referrers, hours, events, groups] = await Promise.all([
      this.repo.query(
        `SELECT count(*) FILTER (WHERE event IN (${VIEW_EVENTS_SQL}))::int AS views,
                count(DISTINCT "visitorId")::int AS visitors,
                count(*) FILTER (WHERE event = 'search')::int AS searches,
                count(*) FILTER (WHERE event IN (${VIEW_EVENTS_SQL}) AND ${appClientSql()})::int AS "appViews"
         FROM visits WHERE ${w}`,
        p,
      ),
      this.repo.query(
        `SELECT path, count(*)::int AS views, count(DISTINCT "visitorId")::int AS visitors
         FROM visits WHERE ${w} AND event IN (${VIEW_EVENTS_SQL})
         GROUP BY path ORDER BY views DESC, path LIMIT 20`,
        p,
      ),
      this.repo.query(
        `SELECT "query" AS query, count(*)::int AS count
         FROM visits WHERE ${w} AND event = 'search' AND coalesce("query", '') <> ''
         GROUP BY 1 ORDER BY count DESC, 1 LIMIT 15`,
        p,
      ),
      this.repo.query(
        `SELECT referrer, count(*)::int AS count
         FROM visits WHERE ${w} AND coalesce(referrer, '') <> ''
         GROUP BY 1 ORDER BY count DESC, 1 LIMIT 10`,
        p,
      ),
      this.repo.query(
        `SELECT extract(hour from ("createdAt" AT TIME ZONE '${KST_ZONE}'))::int AS hour,
                count(*) FILTER (WHERE event IN (${VIEW_EVENTS_SQL}))::int AS views,
                count(DISTINCT "visitorId")::int AS visitors
         FROM visits WHERE ${w}
         GROUP BY 1 ORDER BY 1`,
        p,
      ),
      this.repo.query(
        `SELECT event, count(*)::int AS count FROM visits WHERE ${w} GROUP BY 1 ORDER BY count DESC, 1`,
        p,
      ),
      this.repo.query(
        `SELECT ${routeGroupSql()} AS grp, count(*)::int AS views
         FROM visits WHERE ${w} AND event IN (${VIEW_EVENTS_SQL})
         GROUP BY 1`,
        p,
      ),
    ]);
    const t = totals[0] ?? { views: 0, visitors: 0, searches: 0, appViews: 0 };
    const groupMap = new Map<string, number>(groups.map((g: any) => [g.grp, g.views]));
    return {
      date,
      totals: { ...t, webViews: t.views - t.appViews },
      pages,
      searches,
      referrers,
      hours,
      events,
      groups: this.groupInfo().map((g) => ({ ...g, views: groupMap.get(g.key) ?? 0 })),
    };
  }

  /**
   * 방문 로그를 필터해 최신순으로 한 페이지 읽는다.
   * @param q — 필터·커서·건수(LogsQuery)
   * @returns { range, items, nextCursor(없으면 null), events?(첫 페이지에만: 기간 안 이벤트 목록) }
   * @throws BadRequestException 날짜나 커서가 올바르지 않으면
   */
  async logs(q: LogsQuery) {
    const today = kstDateOf(new Date());
    if (q.from) assertDate(q.from, "시작 날짜");
    if (q.to) assertDate(q.to, "끝 날짜");
    const range = kstRange(q.from ?? addDays(today, -6), q.to ?? today);
    const limit = clampInt(q.limit, 1, MAX_LOG_LIMIT, 50);
    const includeBots = q.bots === "1";
    const { where, params } = buildVisitLogWhere({
      start: range.start,
      end: range.end,
      event: q.event || undefined,
      text: q.text?.trim() || undefined,
      device: q.device,
      client: q.client,
      visitorId: q.visitorId,
      includeBots,
    });

    let cond = where;
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      if (!c || !UUID_RE.test(c.id)) throw new BadRequestException("다음 페이지 정보가 올바르지 않습니다.");
      params.push(c.ts, c.id);
      cond += ` AND ("createdAt", id) < (($${params.length - 1})::timestamp AT TIME ZONE 'UTC', ($${params.length})::uuid)`;
    }
    params.push(limit + 1);

    const rows: any[] = await this.repo.query(
      `SELECT id, "createdAt", ${cursorTsSql(`"createdAt"`)} AS "cursorTs", event, path, "query" AS query, referrer,
              "visitorId", ${appClientSql()} AS app, device, browser, os, country, city, ip
       FROM visits WHERE ${cond}
       ORDER BY "createdAt" DESC, id DESC
       LIMIT $${params.length}`,
      params,
    );
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = rows.length > limit && last ? encodeCursor({ ts: last.cursorTs, id: last.id }) : null;

    const items = page.map((r) => ({
      id: r.id,
      createdAt: new Date(r.createdAt).toISOString(),
      event: r.event,
      path: r.path,
      query: r.query,
      referrer: r.referrer,
      visitorId: r.visitorId,
      client: r.app ? "app" : "web",
      device: r.device,
      browser: r.browser,
      os: r.os,
      country: r.country,
      city: r.city,
      ip: r.ip,
    }));

    // 첫 페이지에서만: 기간 안에 있었던 이벤트 이름 목록(필터 선택지)
    const events = q.cursor
      ? undefined
      : await this.repo.query(
          `SELECT event, count(*)::int AS count FROM visits
           WHERE "createdAt" >= $1 AND "createdAt" < $2 ${includeBots ? "" : `AND ${notBotSql()}`}
           GROUP BY 1 ORDER BY count DESC, 1 LIMIT 60`,
          [range.start, range.end],
        );

    return { range: { from: range.from, to: range.to }, items, nextCursor, ...(events ? { events } : {}) };
  }

  /**
   * 방문자 한 명의 요약을 만든다(검색 로봇 여부와 상관없이 그 방문자의 모든 기록).
   * @param visitorId — 방문자 ID
   * @returns 첫·마지막 방문, 조회·이벤트 수, 방문한 날 수, 앱/웹 사용, 최근 기기, 자주 본 화면
   * @throws NotFoundException 기록이 없으면
   */
  async visitor(visitorId: string) {
    const [sum, latest, topPaths] = await Promise.all([
      this.repo.query(
        `SELECT min("createdAt") AS "firstAt", max("createdAt") AS "lastAt",
                count(*) FILTER (WHERE event IN (${VIEW_EVENTS_SQL}))::int AS views,
                count(*)::int AS events,
                count(DISTINCT ${KST_DATE})::int AS "activeDays",
                coalesce(bool_or(${appClientSql()}), false) AS "usedApp",
                coalesce(bool_or(NOT (${appClientSql()})), false) AS "usedWeb"
         FROM visits WHERE "visitorId" = $1`,
        [visitorId],
      ),
      this.repo.query(
        `SELECT device, browser, os, country, city, ip FROM visits
         WHERE "visitorId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
        [visitorId],
      ),
      this.repo.query(
        `SELECT path, count(*)::int AS views FROM visits
         WHERE "visitorId" = $1 AND event IN (${VIEW_EVENTS_SQL})
         GROUP BY path ORDER BY views DESC, path LIMIT 5`,
        [visitorId],
      ),
    ]);
    const s = sum[0];
    if (!s || s.events === 0) throw new NotFoundException("이 방문자의 기록이 없어요.");
    return {
      visitorId,
      firstAt: new Date(s.firstAt).toISOString(),
      lastAt: new Date(s.lastAt).toISOString(),
      views: s.views,
      events: s.events,
      activeDays: s.activeDays,
      usedApp: s.usedApp,
      usedWeb: s.usedWeb,
      latest: latest[0] ?? null,
      topPaths,
    };
  }
}
