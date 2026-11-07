/**
 * activity-source.ts — 사이트 활동 '출처' 한 가지(글, 댓글, 신고 …)의 공통 모양.
 *
 * 관리자 '활동' 화면은 여러 테이블의 새 기록을 시간순 한 목록으로 보여 준다.
 * 출처마다 이 인터페이스를 구현하고 ActivityService 에 등록하면 목록·하루별 요약에 함께 나온다(전략 패턴).
 * SQL 로 읽는 출처는 SqlActivitySource 를 상속해 테이블·컬럼·한 줄 모양만 정하면 된다(템플릿 메서드).
 */
import { DataSource } from "typeorm";
import { ActivityItem, cursorTsSql, KST_ZONE } from "../analytics-logic";

/** 하루 한 칸의 건수 */
export interface DayCount {
  /** 날짜 'YYYY-MM-DD' (KST) */
  date: string;
  /** 그날 건수 */
  count: number;
}

/** 활동 출처 하나 */
export interface ActivitySource {
  /** 활동 종류 키(응답·필터에 쓰임, 예: "post") */
  readonly type: string;
  /** 관리자 화면에 보일 이름(예: "글") */
  readonly label: string;
  /**
   * 최신순 활동을 읽는다.
   * @param before — 이 시각(UTC, 마이크로초까지 문자열)보다 이전만. null 이면 가장 최근부터
   * @param limit — 최대 건수
   * @returns 최신순 활동 목록
   */
  list(before: string | null, limit: number): Promise<ActivityItem[]>;
  /**
   * 기간 안의 하루별 건수를 센다.
   * @param start — 이 순간 이후(포함)
   * @returns 건수가 있는 날만 담은 목록
   */
  countByDay(start: Date): Promise<DayCount[]>;
}

/** 한 줄 모양(종류·ID·시각은 공통으로 채운다) */
export type ActivityLine = Pick<ActivityItem, "title" | "detail" | "actor" | "link">;

/** SQL 로 읽는 출처의 공통 구현 — 아래 추상 멤버만 정하면 목록·요약 쿼리를 만들어 준다 */
export abstract class SqlActivitySource implements ActivitySource {
  /** 활동 종류 키 */
  abstract readonly type: string;
  /** 관리자 화면에 보일 이름 */
  abstract readonly label: string;
  /** FROM 절(별칭·조인 포함, 예: 'comments c LEFT JOIN posts p ON …') */
  protected abstract readonly fromSql: string;
  /** 활동 시각 컬럼 식(예: 'c."createdAt"') */
  protected abstract readonly timeSql: string;
  /** 행 ID 식(예: 'c.id') — 문자열로 바꿔 돌려준다 */
  protected abstract readonly idSql: string;
  /** 한 줄을 만들 때 쓸 추가 SELECT 목록(별칭 포함) */
  protected abstract readonly columnsSql: string;

  /**
   * @param ds — DB 연결(원시 SQL 실행용)
   */
  constructor(protected readonly ds: DataSource) {}

  /**
   * DB 행 하나를 한 줄 모양으로 바꾼다.
   * @param row — columnsSql 로 읽은 행
   * @returns 제목·설명·사람·링크
   */
  protected abstract toLine(row: Record<string, any>): ActivityLine; // eslint-disable-line @typescript-eslint/no-explicit-any

  /**
   * 최신순 활동을 읽는다.
   * @param before — 이 시각보다 이전만(UTC 마이크로초 문자열). null 이면 가장 최근부터
   * @param limit — 최대 건수
   * @returns 최신순 활동 목록
   */
  async list(before: string | null, limit: number): Promise<ActivityItem[]> {
    const params: unknown[] = [limit];
    const where = before ? `WHERE ${this.timeSql} < ($2::timestamp AT TIME ZONE 'UTC')` : "";
    if (before) params.push(before);
    const rows: Record<string, any>[] = await this.ds.query( // eslint-disable-line @typescript-eslint/no-explicit-any
      `SELECT (${this.idSql})::text AS "_id", ${this.timeSql} AS "_at", ${cursorTsSql(this.timeSql)} AS "_atKey", ${this.columnsSql}
       FROM ${this.fromSql} ${where}
       ORDER BY ${this.timeSql} DESC LIMIT $1`,
      params,
    );
    return rows.map((r) => ({
      type: this.type,
      id: String(r._id),
      at: new Date(r._at).toISOString(),
      atKey: String(r._atKey),
      ...this.toLine(r),
    }));
  }

  /**
   * 기간 안의 하루별 건수를 센다(KST 날짜 기준).
   * @param start — 이 순간 이후(포함)
   * @returns 건수가 있는 날만 담은 목록
   */
  async countByDay(start: Date): Promise<DayCount[]> {
    return this.ds.query(
      `SELECT to_char((${this.timeSql} AT TIME ZONE '${KST_ZONE}')::date, 'YYYY-MM-DD') AS date, count(*)::int AS count
       FROM ${this.fromSql} WHERE ${this.timeSql} >= $1
       GROUP BY 1`,
      [start],
    );
  }
}
