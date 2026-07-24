/**
 * analytics.service.ts
 *
 * 방문/이벤트 트래킹 데이터를 저장하고, 관리자용 통계를 집계하는 서비스.
 * - track: 방문 기록 1건을 Visit 테이블에 저장(UA 파싱·필드 길이 제한 포함)
 * - stats: 지정 기간(days) 동안의 다양한 통계를 원시 SQL로 병렬 집계
 * - recent: 최근 방문 로그를 최신순으로 조회
 */
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Visit } from "../database/entities";
import { TrackDto } from "./dto";
import { parseUA } from "./ua.util";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 방문 기록 저장 및 통계 집계를 담당하는 서비스.
 * Visit 리포지토리와 원시 SQL 쿼리를 함께 사용한다.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  /**
   * @param repo — 방문 기록(Visit) 엔티티 리포지토리(의존성 주입)
   */
  constructor(
    @InjectRepository(Visit) private readonly repo: Repository<Visit>,
  ) {}

  /**
   * 방문/이벤트 1건을 저장한다. userAgent 를 파싱해 browser/os/device 를 채우고,
   * 각 문자열 필드는 컬럼 한도에 맞춰 잘라서 저장한다.
   * 저장 실패는 예외를 던지지 않고 조용히 처리한다(사용자 경험 보호).
   *
   * @param dto — 저장할 방문/이벤트 정보(path 필수, 그 외 선택)
   * @returns 저장 성공 여부 { ok: boolean } (성공 true, 실패 false)
   */
  async track(dto: TrackDto) {
    try {
      const { browser, os, device } = parseUA(dto.userAgent);
      const visit = this.repo.create({
        visitorId: (dto.visitorId || "unknown").slice(0, 64),
        event: (dto.event || "pageview").slice(0, 32),
        path: dto.path.slice(0, 512),
        referrer: dto.referrer?.slice(0, 1024) ?? null,
        query: dto.query?.slice(0, 190) ?? null,
        ip: dto.ip?.slice(0, 64) ?? null,
        country: dto.country?.slice(0, 8) ?? null,
        city: dto.city?.slice(0, 128) ?? null,
        browser,
        os,
        device,
        userAgent: dto.userAgent ?? null,
      });
      await this.repo.save(visit);
      return { ok: true };
    } catch (e) {
      // 트래킹 실패가 사용자 경험을 막지 않도록 조용히 처리
      this.logger.warn(`track 실패: ${(e as Error).message}`);
      return { ok: false };
    }
  }

  /**
   * 지정한 기간(days) 동안의 방문 통계를 원시 SQL로 병렬 집계한다.
   *
   * @param daysInput — 집계 기간(일). 1~365로 보정되며 잘못된 값은 30으로 대체.
   * @returns 집계 결과 객체:
   *   range(기간), totals(총계: 조회수·방문자·오늘 조회수·오늘 방문자),
   *   byDay(일자별), topPages(인기 페이지), topSearches(인기 검색어),
   *   topReferrers(유입 경로), byCountry(국가별), byDevice(기기별),
   *   byBrowser(브라우저별), byHour(시간대별·Asia/Seoul 기준),
   *   events(이벤트별), byOs(OS별)
   */
  async stats(daysInput = 30) {
    const days = Math.min(365, Math.max(1, Math.floor(daysInput) || 30));
    const w = `"createdAt" >= now() - interval '${days} days'`;

    const [
      totalsRow,
      byDay,
      topPages,
      topSearches,
      topReferrers,
      byCountry,
      byDevice,
      byBrowser,
      byHour,
      eventsRaw,
      byOs,
    ] = await Promise.all([
        this.repo.query(`
          SELECT
            (SELECT count(*) FROM visits WHERE ${w})::int AS views,
            (SELECT count(distinct "visitorId") FROM visits WHERE ${w})::int AS visitors,
            (SELECT count(*) FROM visits WHERE "createdAt" >= date_trunc('day', now()))::int AS "todayViews",
            (SELECT count(distinct "visitorId") FROM visits WHERE "createdAt" >= date_trunc('day', now()))::int AS "todayVisitors"
        `),
        this.repo.query(`
          SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date,
                 count(*)::int AS views,
                 count(distinct "visitorId")::int AS uniques
          FROM visits WHERE ${w}
          GROUP BY 1 ORDER BY 1
        `),
        this.repo.query(`
          SELECT path, count(*)::int AS views
          FROM visits WHERE ${w} AND event = 'pageview'
          GROUP BY path ORDER BY views DESC LIMIT 12
        `),
        this.repo.query(`
          SELECT "query" AS query, count(*)::int AS count
          FROM visits WHERE ${w} AND event = 'search' AND "query" IS NOT NULL AND "query" <> ''
          GROUP BY "query" ORDER BY count DESC LIMIT 12
        `),
        this.repo.query(`
          SELECT referrer, count(*)::int AS views
          FROM visits WHERE ${w} AND referrer IS NOT NULL AND referrer <> ''
          GROUP BY referrer ORDER BY views DESC LIMIT 10
        `),
        this.repo.query(`
          SELECT coalesce(nullif(country, ''), '??') AS country, count(*)::int AS views
          FROM visits WHERE ${w}
          GROUP BY 1 ORDER BY views DESC LIMIT 12
        `),
        this.repo.query(`
          SELECT coalesce(device, '기타') AS device, count(*)::int AS views
          FROM visits WHERE ${w}
          GROUP BY 1 ORDER BY views DESC
        `),
        this.repo.query(`
          SELECT coalesce(browser, '기타') AS browser, count(*)::int AS views
          FROM visits WHERE ${w}
          GROUP BY 1 ORDER BY views DESC LIMIT 8
        `),
        this.repo.query(`
          SELECT extract(hour from ("createdAt" at time zone 'Asia/Seoul'))::int AS hour,
                 count(*)::int AS views,
                 count(distinct "visitorId")::int AS uniques
          FROM visits WHERE ${w}
          GROUP BY 1 ORDER BY 1
        `),
        this.repo.query(`
          SELECT event, count(*)::int AS count
          FROM visits WHERE ${w}
          GROUP BY event ORDER BY count DESC
        `),
        this.repo.query(`
          SELECT coalesce(nullif(os, ''), '기타') AS os, count(*)::int AS views
          FROM visits WHERE ${w}
          GROUP BY 1 ORDER BY views DESC LIMIT 8
        `),
      ]);

    const totals = totalsRow[0] ?? { views: 0, visitors: 0, todayViews: 0, todayVisitors: 0 };
    return {
      range: { days },
      totals,
      byDay,
      topPages,
      topSearches,
      topReferrers,
      byCountry,
      byDevice,
      byBrowser,
      byHour,
      events: eventsRaw,
      byOs,
    };
  }

  /**
   * 최근 방문 로그를 최신순으로 조회한다.
   *
   * @param limitInput — 반환할 로그 개수. 1~200으로 보정되며 잘못된 값은 50으로 대체.
   * @returns 최신순 방문 로그 배열(생성시각·이벤트·경로·검색어·리퍼러·국가·도시·기기·브라우저·OS·IP)
   */
  async recent(limitInput = 50) {
    const limit = Math.min(200, Math.max(1, Math.floor(limitInput) || 50));
    return this.repo.query(`
      SELECT "createdAt", event, path, "query" AS query, referrer,
             country, city, device, browser, os, ip
      FROM visits
      ORDER BY "createdAt" DESC
      LIMIT ${limit}
    `);
  }
}
