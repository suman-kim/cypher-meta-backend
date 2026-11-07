/**
 * activity.service.ts — 관리자 '활동' 화면 서비스.
 * 등록된 활동 출처(글·댓글·신고 …)를 모아 최신순 한 목록과 하루별·종류별 건수를 만든다.
 * 새 출처는 sources 배열에 한 줄 더하면 목록·요약·필터에 함께 나온다.
 */
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import {
  ActivityItem,
  clampInt,
  kstDayStart,
  MAX_DAILY_DAYS,
  mergeActivities,
  recentKstDates,
} from "../analytics-logic";
import { ActivitySource, DayCount } from "./activity-source";
import {
  CommentActivity,
  CostumeFeedbackActivity,
  PostActivity,
  PushDeviceActivity,
  ReportActivity,
  UpdateCommentActivity,
  VoteActivity,
} from "./activity-sources";

/** 활동 목록 한 페이지 최대 건수 */
const MAX_ACTIVITY_LIMIT = 100;

/** 활동 종류 안내(필터·범례용) */
export interface ActivityTypeInfo {
  /** 종류 키 */
  key: string;
  /** 보일 이름 */
  label: string;
}

/** 사이트 활동 목록·요약 서비스 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);
  /** 등록된 활동 출처(화면의 종류 순서) */
  private readonly sources: ActivitySource[];

  /**
   * @param ds — DB 연결(각 출처가 원시 SQL 로 읽는다)
   */
  constructor(@InjectDataSource() ds: DataSource) {
    this.sources = [
      new PostActivity(ds),
      new CommentActivity(ds),
      new UpdateCommentActivity(ds),
      new ReportActivity(ds),
      new VoteActivity(ds),
      new CostumeFeedbackActivity(ds),
      new PushDeviceActivity(ds),
    ];
  }

  /** @returns 활동 종류 목록(키·이름) */
  types(): ActivityTypeInfo[] {
    return this.sources.map((s) => ({ key: s.type, label: s.label }));
  }

  /**
   * 쉼표로 받은 종류를 출처 목록으로 바꾼다. 비어 있으면 전체.
   * @param types — "post,comment" 형태(선택)
   * @returns 고른 출처 목록
   * @throws BadRequestException 알 수 없는 종류가 있으면
   */
  private pick(types?: string): ActivitySource[] {
    if (!types) return this.sources;
    const keys = [...new Set(types.split(","))];
    const unknown = keys.filter((k) => !this.sources.some((s) => s.type === k));
    if (unknown.length > 0) throw new BadRequestException(`알 수 없는 활동 종류: ${unknown.join(", ")}`);
    return this.sources.filter((s) => keys.includes(s.type));
  }

  /**
   * 활동을 최신순으로 한 페이지 읽는다.
   * @param q.types — 볼 종류(쉼표 구분, 선택)
   * @param q.before — 이 시각보다 이전부터(이전 응답의 nextBefore, 선택)
   * @param q.limit — 한 페이지 건수(1~100, 기본 50)
   * @returns { items: 활동 목록, nextBefore: 다음 페이지 기준(없으면 null), types: 전체 종류 안내 }
   */
  async list(q: { types?: string; before?: string; limit?: string }): Promise<{
    items: ActivityItem[];
    nextBefore: string | null;
    types: ActivityTypeInfo[];
  }> {
    const sources = this.pick(q.types);
    const limit = clampInt(q.limit, 1, MAX_ACTIVITY_LIMIT, 50);
    const lists = await Promise.all(sources.map((s) => this.safeList(s, q.before ?? null, limit + 1)));
    return { ...mergeActivities(lists, limit), types: this.types() };
  }

  /**
   * 최근 N일 하루별·종류별 활동 수를 센다.
   * @param daysInput — 일수(1~120, 기본 30)
   * @returns { range, types: 종류별 합계, rows: 날짜별(오래된 순) 종류별 건수 }
   */
  async summary(daysInput?: string) {
    const days = clampInt(daysInput, 1, MAX_DAILY_DAYS, 30);
    const dates = recentKstDates(days);
    const start = kstDayStart(dates[0]);
    const counts = await Promise.all(this.sources.map((s) => this.safeCount(s, start)));

    // 출처별 날짜 → 건수
    const maps = counts.map((list) => new Map(list.map((c) => [c.date, c.count])));
    const rows = dates.map((date) => {
      const byType: Record<string, number> = {};
      let total = 0;
      this.sources.forEach((s, i) => {
        const n = maps[i].get(date) ?? 0;
        byType[s.type] = n;
        total += n;
      });
      return { date, byType, total };
    });

    const types = this.sources.map((s, i) => ({
      key: s.type,
      label: s.label,
      total: counts[i].reduce((sum, c) => sum + c.count, 0),
    }));
    return { range: { days, from: dates[0], to: dates[dates.length - 1] }, types, rows };
  }

  /**
   * 출처 하나의 목록을 읽되, 실패하면(테이블이 아직 없는 등) 빈 목록으로 두고 나머지는 보여 준다.
   * @param s — 출처
   * @param before — 기준 시각
   * @param limit — 최대 건수
   * @returns 활동 목록
   */
  private async safeList(s: ActivitySource, before: string | null, limit: number): Promise<ActivityItem[]> {
    try {
      return await s.list(before, limit);
    } catch (e) {
      this.logger.warn(`활동 목록(${s.type}) 읽기 실패: ${(e as Error).message}`);
      return [];
    }
  }

  /**
   * 출처 하나의 하루별 건수를 읽되, 실패하면 빈 목록으로 둔다.
   * @param s — 출처
   * @param start — 기간 시작 순간
   * @returns 하루별 건수
   */
  private async safeCount(s: ActivitySource, start: Date): Promise<DayCount[]> {
    try {
      return await s.countByDay(start);
    } catch (e) {
      this.logger.warn(`활동 요약(${s.type}) 읽기 실패: ${(e as Error).message}`);
      return [];
    }
  }
}
