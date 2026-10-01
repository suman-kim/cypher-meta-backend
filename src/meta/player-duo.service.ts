/**
 * player-duo.service.ts
 * ---------------------------------------------------------------------------
 * 플레이어 2명 비교 — 두 사람이 같은 팀으로 뛴 경기(함께한 경기)와 상대 팀으로 만난 경기(상대 전적).
 *
 * 원천은 개인 히스토리 적립 테이블(player_matches): 두 플레이어의 행을 matchId 로 교차한다.
 *  - 공식전: 목록 API 가 승패를 주므로 결과가 같으면 같은 팀, 다르면 상대 팀(승패 집계 가능).
 *  - 일반전: 목록 API 에 승패가 없어 매치 상세의 teams(팀별 참가자)로 같은 팀/상대만 가린다(승패 없음).
 *    매치 상세는 현재 시즌만 남으므로 지난 시즌 일반전은 '판별 불가'(unknown).
 * 처음 보는 플레이어는 기존 적립(PlayerHistoryService.syncOnView)을 뒤에서 돌리고 pending 으로 알린다.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, Repository } from "typeorm";
import { TrackedPlayer } from "../database/entities";
import { NeopleService } from "../neople/neople.service";
import { PlayerHistoryService } from "./player-history.service";

/** 두 플레이어의 관계 — 같은 팀 / 상대 팀 / 판별 불가 / 팀 확인 대기(일반전, 다음 요청에서 판별) */
export type DuoRelation = "together" | "opponent" | "unknown" | "checking";

/** 한 요청에서 매치 상세로 팀을 확인할 일반전 최대 경기 수(최근 경기부터) */
const MAX_TEAM_LOOKUPS = 60;
/** 매치 상세 동시 조회 수 */
const LOOKUP_CONCURRENCY = 6;
/** 팀 구성 캐시 최대 크기(넘으면 오래된 것부터 버림) */
const TEAM_CACHE_LIMIT = 20000;
/** 응답에 담을 경기 목록 최대 수 */
const MAX_MATCHES = 300;

/** 교차 조회 1행(두 플레이어가 함께 기록된 경기) */
interface SharedRow {
  matchId: string;
  gameTypeId: string | null;
  playedAt: Date | null;
  aCharacterId: string;
  aCharacterName: string | null;
  aResult: string | null;
  aKill: number;
  aDeath: number;
  aAssist: number;
  aUltimate: string | null;
  bCharacterId: string;
  bCharacterName: string | null;
  bResult: string | null;
  bKill: number;
  bDeath: number;
  bAssist: number;
  bUltimate: string | null;
}

@Injectable()
export class PlayerDuoService {
  private readonly logger = new Logger(PlayerDuoService.name);
  /** 일반전 매치별 팀 구성(matchId → 팀별 playerId 목록, null=상세 없음·판별 불가). 팀 구성은 바뀌지 않는다. */
  private readonly teamCache = new Map<string, string[][] | null>();
  /** 진행 중인 적립(playerId → Promise) — 같은 플레이어 중복 적립 방지 */
  private readonly syncing = new Map<string, Promise<unknown>>();

  /**
   * @param dataSource — 교차 조회(원시 SQL)용
   * @param tpRepo — 적립 대상(watchlist) 상태 조회용
   * @param history — 개인 히스토리 적립(처음 보는 플레이어 백필)
   * @param neople — 일반전 매치 상세(팀 구성) 조회용 Neople 프록시
   */
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(TrackedPlayer) private readonly tpRepo: Repository<TrackedPlayer>,
    private readonly history: PlayerHistoryService,
    private readonly neople: NeopleService,
  ) {}

  /**
   * 두 플레이어의 함께한 경기 / 상대 전적.
   * @param q.a — 플레이어 A ID
   * @param q.b — 플레이어 B ID
   * @param q.gameType — "all"(기본) | "rating" | "normal"
   * @param q.an — 플레이어 A 닉네임(선택, 적립 대상 등록용)
   * @param q.bn — 플레이어 B 닉네임(선택)
   * @returns 플레이어별 적립 현황(pending=적립 중), 함께한 경기·상대 전적 집계,
   *   unknown(판별 불가)·teamPending(팀 확인 대기, 재요청 시 이어서 판별), 경기 목록(최신순)
   */
  async duo(q: { a: string; b: string; gameType?: string; an?: string; bn?: string }) {
    const a = q.a.toLowerCase();
    const b = q.b.toLowerCase();
    if (a === b) throw new BadRequestException("서로 다른 두 플레이어를 입력해 주세요.");
    const gameType = q.gameType ?? "all";

    // 1) 적립 상태 — 처음 보는 플레이어는 뒤에서 전체 적립을 시작하고 pending 으로 알린다
    const tracked = await this.tpRepo.find({ where: { playerId: In([a, b]) } });
    const pendingA = this.kickSync(a, q.an, tracked);
    const pendingB = this.kickSync(b, q.bn, tracked);

    // 2) 두 플레이어가 함께 기록된 경기 교차
    const rows = await this.sharedMatches(a, b, gameType);

    // 3) 일반전(승패 없음)은 매치 상세의 팀 구성으로 관계를 판별
    const needTeams = rows
      .filter((r) => !this.decided(r))
      .map((r) => r.matchId)
      .filter((id) => !this.teamCache.has(id))
      .slice(0, MAX_TEAM_LOOKUPS);
    await this.loadTeams(needTeams);

    // 4) 관계 판별 + 집계
    const together = { games: 0, decided: 0, wins: 0, losses: 0 };
    const opponents = { games: 0, decided: 0, aWins: 0, bWins: 0 };
    let unknown = 0;
    const matches = rows.map((r) => {
      const relation = this.relationOf(r, a, b);
      const decided = this.decided(r);
      if (relation === "together") {
        together.games++;
        if (decided) {
          together.decided++;
          if (r.aResult === "win") together.wins++;
          else together.losses++;
        }
      } else if (relation === "opponent") {
        opponents.games++;
        if (decided) {
          opponents.decided++;
          if (r.aResult === "win") opponents.aWins++;
          else opponents.bWins++;
        }
      } else if (relation === "unknown") unknown++;
      return {
        matchId: r.matchId,
        gameTypeId: r.gameTypeId,
        playedAt: r.playedAt,
        relation,
        a: this.side(r, "a"),
        b: this.side(r, "b"),
      };
    });

    // 아직 팀 구성을 확인하지 못한 일반전(한 요청 조회 상한에 걸린 경기) — 화면이 다시 요청해 이어서 판별한다
    const teamPending = matches.filter((m) => m.relation === "checking").length;

    const coverage = await this.coverage([a, b]);
    return {
      gameType,
      a: { playerId: a, pending: pendingA, ...coverage[a] },
      b: { playerId: b, pending: pendingB, ...coverage[b] },
      together: { ...together, winRate: rate(together.wins, together.decided) },
      opponents: { ...opponents, aWinRate: rate(opponents.aWins, opponents.decided) },
      unknown,
      teamPending,
      total: rows.length,
      matches: matches.slice(0, MAX_MATCHES),
    };
  }

  /**
   * 적립을 뒤에서 시작한다(기다리지 않음). 이미 전체 적립된 플레이어도 최근분 갱신을 맡긴다
   * (syncOnView 가 30분 안 재요청은 건너뛴다).
   * @param playerId — 플레이어 ID
   * @param nickname — 닉네임(적립 대상 등록용)
   * @param tracked — 미리 읽어 둔 적립 대상 행
   * @returns 아직 전체 적립 전이면 true(결과가 늘어날 수 있음)
   */
  private kickSync(playerId: string, nickname: string | undefined, tracked: TrackedPlayer[]): boolean {
    const backfilled = !!tracked.find((t) => t.playerId === playerId)?.backfilled;
    if (!this.syncing.has(playerId)) {
      const p = this.history
        .syncOnView(playerId, nickname ?? null)
        .catch((e) => this.logger.warn(`비교용 적립 실패(무시) ${playerId}: ${(e as Error).message}`))
        .finally(() => this.syncing.delete(playerId));
      this.syncing.set(playerId, p);
    }
    return !backfilled;
  }

  /**
   * 두 플레이어가 함께 기록된 경기(최신순).
   * @param a — 플레이어 A ID
   * @param b — 플레이어 B ID
   * @param gameType — all | rating | normal
   * @returns 교차 행 목록
   */
  private async sharedMatches(a: string, b: string, gameType: string): Promise<SharedRow[]> {
    const params: any[] = [a, b];
    let gt = `AND a."gameTypeId" IN ('rating', 'normal')`;
    if (gameType !== "all") {
      gt = `AND a."gameTypeId" = $3`;
      params.push(gameType);
    }
    const rows: any[] = await this.dataSource.query(
      `SELECT a."matchId", a."gameTypeId", a."playedAt",
              a."characterId" AS "aCharacterId", a."characterName" AS "aCharacterName", a.result AS "aResult",
              a."killCount" AS "aKill", a."deathCount" AS "aDeath", a."assistCount" AS "aAssist", a."ultimateType" AS "aUltimate",
              b."characterId" AS "bCharacterId", b."characterName" AS "bCharacterName", b.result AS "bResult",
              b."killCount" AS "bKill", b."deathCount" AS "bDeath", b."assistCount" AS "bAssist", b."ultimateType" AS "bUltimate"
         FROM player_matches a
         JOIN player_matches b ON b."matchId" = a."matchId" AND b."playerId" = $2
        WHERE a."playerId" = $1 ${gt}
        ORDER BY a."playedAt" DESC NULLS LAST`,
      params,
    );
    return rows as SharedRow[];
  }

  /**
   * 두 사람 모두 승패가 있는 경기인지(공식전) — 승패로 관계와 승자를 알 수 있다.
   * @param r — 교차 행
   * @returns 승패가 모두 있으면 true
   */
  private decided(r: SharedRow): boolean {
    return isResult(r.aResult) && isResult(r.bResult);
  }

  /**
   * 경기에서 두 플레이어의 관계.
   *  - 승패가 있으면: 결과가 같으면 같은 팀, 다르면 상대 팀
   *  - 없으면(일반전): 매치 상세 팀 구성으로 판별 — 상세가 없으면 unknown, 아직 조회 전이면 checking
   * @param r — 교차 행
   * @param a — 플레이어 A ID
   * @param b — 플레이어 B ID
   * @returns 관계
   */
  private relationOf(r: SharedRow, a: string, b: string): DuoRelation {
    if (this.decided(r)) return r.aResult === r.bResult ? "together" : "opponent";
    if (!this.teamCache.has(r.matchId)) return "checking";
    const teams = this.teamCache.get(r.matchId);
    if (!teams) return "unknown";
    const ta = teams.findIndex((t) => t.includes(a));
    const tb = teams.findIndex((t) => t.includes(b));
    if (ta < 0 || tb < 0) return "unknown";
    return ta === tb ? "together" : "opponent";
  }

  /**
   * 매치 상세에서 팀 구성을 읽어 캐시에 채운다(동시 조회 수 제한).
   * 상세가 없는 경기(지난 시즌 등)는 null 로 기록해 다시 부르지 않고,
   * 점검·일시 오류는 기록하지 않아 다음 요청에서 다시 시도한다.
   * @param matchIds — 팀 구성이 필요한 경기 ID
   */
  private async loadTeams(matchIds: string[]): Promise<void> {
    let i = 0;
    const worker = async () => {
      while (i < matchIds.length) {
        const id = matchIds[i++];
        try {
          // 매치 상세는 크고 여기서는 팀 구성만 필요해 api_cache 에 저장하지 않는다
          const d: any = await this.neople.proxy(`/matches/${encodeURIComponent(id)}`, { store: false });
          const teams: string[][] = (Array.isArray(d?.teams) ? d.teams : []).map((t: any) =>
            (Array.isArray(t?.players) ? t.players : [])
              .map((p: any) => String(typeof p === "string" ? p : p?.playerId ?? "").toLowerCase())
              .filter(Boolean),
          );
          this.remember(id, teams.length ? teams : null);
        } catch (e) {
          const status = (e as { getStatus?: () => number }).getStatus?.();
          if (status === 404 || status === 400) this.remember(id, null); // 상세 없음(지난 시즌) — 판별 불가로 고정
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, matchIds.length) }, worker));
  }

  /**
   * 팀 구성 캐시에 기록한다(상한을 넘으면 가장 오래된 항목부터 버림).
   * @param matchId — 경기 ID
   * @param teams — 팀별 playerId 목록(null=판별 불가)
   */
  private remember(matchId: string, teams: string[][] | null): void {
    if (this.teamCache.size >= TEAM_CACHE_LIMIT) {
      const oldest = this.teamCache.keys().next().value;
      if (oldest !== undefined) this.teamCache.delete(oldest);
    }
    this.teamCache.set(matchId, teams);
  }

  /**
   * 교차 행에서 한 플레이어 쪽 기록만 뽑는다.
   * @param r — 교차 행
   * @param who — "a" | "b"
   * @returns 캐릭터·승패·KDA·궁극기
   */
  private side(r: SharedRow, who: "a" | "b") {
    const g = (k: string) => (r as any)[`${who}${k}`];
    return {
      characterId: g("CharacterId") as string,
      characterName: (g("CharacterName") as string | null) ?? null,
      result: isResult(g("Result")) ? (g("Result") as string) : null,
      kill: Number(g("Kill") ?? 0),
      death: Number(g("Death") ?? 0),
      assist: Number(g("Assist") ?? 0),
      ultimateType: (g("Ultimate") as string | null) ?? null,
    };
  }

  /**
   * 두 플레이어의 적립 현황(누적 경기 수·기간).
   * @param ids — 플레이어 ID 목록
   * @returns playerId → { matchCount, oldest, newest }
   */
  private async coverage(ids: string[]) {
    const rows: any[] = await this.dataSource.query(
      `SELECT "playerId", count(*)::int AS cnt, min("playedAt") AS oldest, max("playedAt") AS newest
         FROM player_matches WHERE "playerId" = ANY($1) GROUP BY "playerId"`,
      [ids],
    );
    const out: Record<string, { matchCount: number; oldest: Date | null; newest: Date | null }> = {};
    for (const id of ids) {
      const r = rows.find((x) => x.playerId === id);
      out[id] = { matchCount: r?.cnt ?? 0, oldest: r?.oldest ?? null, newest: r?.newest ?? null };
    }
    return out;
  }
}

/**
 * 승패 값인지.
 * @param v — result 값
 * @returns "win" | "lose" 면 true
 */
function isResult(v: unknown): boolean {
  return v === "win" || v === "lose";
}

/**
 * 백분율(소수 1자리). 분모가 0이면 null.
 * @param n — 분자
 * @param d — 분모
 * @returns 백분율 또는 null
 */
function rate(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : null;
}
