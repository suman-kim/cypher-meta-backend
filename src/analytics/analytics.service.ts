import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Visit } from "../database/entities";
import { TrackDto } from "./dto";
import { parseUA } from "./ua.util";

/* eslint-disable @typescript-eslint/no-explicit-any */

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectRepository(Visit) private readonly repo: Repository<Visit>,
  ) {}

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
