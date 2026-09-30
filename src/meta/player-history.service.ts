/**
 * player-history.service.ts
 * ---------------------------------------------------------------------------
 * "개인 히스토리 적립" 파이프라인.
 *
 * 메타 수집(상위 랭커 → 매치 상세 → 참가자 전원 저장)과 목적이 다르다. 이쪽은
 * 개별 플레이어 1명의 매치 "목록"(/players/{id}/matches)만 싸게 긁어와
 * player_matches 에 그 사람 관점의 1행씩 적립한다. (매치 상세를 부르지 않음)
 *
 * 왜 적립인가: Neople 매치 목록 API 는 현재 시즌(약 5개월)만 보관한다. 즉 지금
 * 조회 가능한 구간을 그때그때 DB로 복사해두지 않으면, 시즌이 지날 때 과거가 영영
 * 사라진다. 그래서 조회/검색 시점마다 (playerId,matchId) 멱등 upsert 로 쌓고,
 * 시간이 지나며 시즌들을 이어붙여 "연도별" 분석을 가능하게 한다.
 *
 * 진입점
 *  - syncOnView(): 프로필 조회 시 호출 — watchlist 등록 + 수집(첫 조회 전체 백필, 이후 최근분).
 *  - refreshWatchlist(): 수동 배치(관리자) — 신규 전체 백필/기존 최근분 갱신(물량 상한).
 *  - summary(): 적립된 데이터로 개인 분석 요약(연/포지션/주력캐릭 등) 산출.
 *    기존 포지션(탱커/근딜/원딜/서포터, 캐릭터명 정적 분류) 결과는 그대로 두고(롤백 대비),
 *    공식 역할군·1차/2차 결과를 official* 필드로 함께 낸다.
 *    궁극기(ultimateType)는 PlayerUltimateService 가 매치 상세 아이템으로 뒤에서 채운다.
 */
import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, Repository, Table } from "typeorm";
import { PlayerMatch, TrackedPlayer } from "../database/entities";
import { NeopleService } from "../neople/neople.service";
import { classifyRole } from "./character-roles";
import { kstYear, parseNeopleDate } from "./match-parser";
import { PlayerUltimateService } from "./player-ultimate.service";
import { UltimateService } from "./ultimate.service";

/* eslint-disable @typescript-eslint/no-explicit-any */

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class PlayerHistoryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PlayerHistoryService.name);
  private ready: Promise<void> | null = null;

  constructor(
    @InjectRepository(PlayerMatch) private readonly pmRepo: Repository<PlayerMatch>,
    @InjectRepository(TrackedPlayer) private readonly tpRepo: Repository<TrackedPlayer>,
    private readonly neople: NeopleService,
    private readonly dataSource: DataSource,
    private readonly playerUltimates: PlayerUltimateService,
    private readonly ultimates: UltimateService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.ensureReady();
      this.logger.log("player_matches/tracked_players 준비 완료");
    } catch (e) {
      this.logger.error(`개인 히스토리 초기화 실패: ${(e as Error).message}`);
    }
  }

  private ensureReady(): Promise<void> {
    if (!this.ready) this.ready = this.ensureTables();
    return this.ready;
  }

  /** player_matches / tracked_players 테이블을 엔티티 메타데이터로 idempotent 생성하고, 궁극기 판별 컬럼을 보장한다. */
  private async ensureTables(): Promise<void> {
    const qr = this.dataSource.createQueryRunner();
    try {
      await qr.connect();
      for (const Entity of [PlayerMatch, TrackedPlayer]) {
        const meta = this.dataSource.getMetadata(Entity);
        if (!(await qr.hasTable(meta.tableName))) {
          await qr.createTable(Table.create(meta, this.dataSource.driver), true, false, true);
          this.logger.log(`테이블 생성: ${meta.tableName}`);
        }
      }
      // DB_SYNC=false 운영계에서도 궁극기 판별 컬럼 보장 + 미처리 행 조회용 부분 인덱스
      await qr.query(`ALTER TABLE player_matches ADD COLUMN IF NOT EXISTS "ultimateType" varchar`);
      await qr.query(`ALTER TABLE player_matches ADD COLUMN IF NOT EXISTS "ultimateCheckedAt" timestamptz`);
      await qr.query(
        `CREATE INDEX IF NOT EXISTS "IDX_player_matches_ult_pending" ON player_matches ("playerId") WHERE "ultimateCheckedAt" IS NULL`,
      );
    } finally {
      await qr.release();
    }
  }

  // ---------------------------------------------------------------- 파싱/저장

  /** /players/{id}/matches 목록 아이템 1건 → player_matches 행. 유효하지 않으면 null. */
  private parseItem(playerId: string, item: any, gameType: string): Partial<PlayerMatch> | null {
    const matchId = item?.matchId;
    const info = item?.playInfo ?? {};
    const characterId = String(info.characterId ?? "");
    if (!matchId || !characterId) return null;
    const d = parseNeopleDate(item?.date); // Neople date 는 KST(타임존 표기 없음)
    return {
      playerId,
      matchId: String(matchId),
      gameTypeId: item?.gameTypeId ?? gameType ?? null,
      playedAt: d,
      characterId,
      characterName: info.characterName ?? null,
      result: info.result ?? null,
      mapName: item?.map?.name ?? null,
      killCount: n(info.killCount),
      deathCount: n(info.deathCount),
      assistCount: n(info.assistCount),
      playTime: info.playTime != null ? n(info.playTime) : null,
      level: info.level != null ? n(info.level) : null,
      stats: {
        attackPoint: n(info.attackPoint),
        damagePoint: n(info.damagePoint),
        battlePoint: n(info.battlePoint),
        sightPoint: n(info.sightPoint),
        towerAttackPoint: n(info.towerAttackPoint),
        healAmount: n(info.healAmount),
        backAttackCount: n(info.backAttackCount),
        comboCount: n(info.comboCount),
        sentinelKillCount: n(info.sentinelKillCount),
        demolisherKillCount: n(info.demolisherKillCount),
        ace: info?.aceInfo?.name ?? null,
      },
    };
  }

  /** 아이템 배열을 파싱해 (playerId,matchId) 충돌은 무시(ON CONFLICT DO NOTHING)하고 적립. 시도 행수 반환. */
  private async upsertItems(playerId: string, items: any[], gameType: string): Promise<number> {
    const rows = items
      .map((it) => this.parseItem(playerId, it, gameType))
      .filter((r): r is Partial<PlayerMatch> => !!r);
    if (!rows.length) return 0;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      await this.pmRepo.createQueryBuilder().insert().into(PlayerMatch).values(chunk as any).orIgnore().execute();
    }
    return rows.length;
  }

  // ---------------------------------------------------------------- API 조회

  /**
   * 한 날짜창(또는 기본 최근)에서 매치 목록을 next 페이지네이션으로 모은다.
   * @param maxPages — 안전 상한(과도한 호출 방지).
   */
  private async fetchWindow(
    playerId: string,
    gameType: string,
    startDate: string | null,
    endDate: string | null,
    maxPages: number,
  ): Promise<any[]> {
    const items: any[] = [];
    let next: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      let q = `/players/${encodeURIComponent(playerId)}/matches?gameTypeId=${encodeURIComponent(gameType)}&limit=100`;
      if (startDate) q += `&startDate=${startDate}`;
      if (endDate) q += `&endDate=${endDate}`;
      if (next) q += `&next=${encodeURIComponent(next)}`;
      let resp: any;
      try {
        resp = await this.neople.proxy(q);
      } catch {
        break;
      }
      const mm = resp?.matches;
      const rows = Array.isArray(mm) ? mm : Array.isArray(mm?.rows) ? mm.rows : [];
      for (const it of rows) items.push(it);
      next = resp?.next ?? mm?.next ?? undefined;
      if (!next || rows.length === 0) break;
    }
    return items;
  }

  /** 최근분만 가볍게 적립(기본 최근 페이지). 조회 시점 훅용. */
  async ingestRecent(playerId: string, gameType = "rating"): Promise<number> {
    await this.ensureReady();
    const items = await this.fetchWindow(playerId, gameType, null, null, 2);
    return this.upsertItems(playerId, items, gameType);
  }

  /**
   * 전체 백필: 오늘부터 89일 창을 과거로 밀며 보관 바닥까지 적립.
   * 빈 창을 만나면(그 이전은 전부 빔) 중단. 총 API 호출 상한으로도 보호.
   */
  async ingestFull(playerId: string, gameType = "rating"): Promise<number> {
    await this.ensureReady();
    const MAX_WINDOWS = 8; // ~2년치 시도(실제 보관은 ~5개월 → 대개 1~2창에서 멈춤)
    const WINDOW_DAYS = 89;
    let end = new Date();
    let total = 0;
    let emptyStreak = 0;
    for (let w = 0; w < MAX_WINDOWS; w++) {
      const start = new Date(end.getTime() - WINDOW_DAYS * DAY);
      const items = await this.fetchWindow(playerId, gameType, ymd(start), ymd(end), 6);
      if (items.length === 0) {
        // 최근 창이 비어도 더 과거에(일반전처럼) 드문드문 있을 수 있어, 2연속 빈 창에서만 중단.
        if (++emptyStreak >= 2) break;
      } else {
        emptyStreak = 0;
        total += await this.upsertItems(playerId, items, gameType);
      }
      end = new Date(start.getTime() - DAY); // 다음(더 과거) 창
    }
    return total;
  }

  // ---------------------------------------------------------------- watchlist

  /** watchlist 등록/갱신(멱등). backfilled/커버리지는 보존. */
  async track(playerId: string, nickname?: string | null, source = "search"): Promise<void> {
    await this.ensureReady();
    await this.tpRepo.upsert(
      { playerId, nickname: nickname ?? null, source, active: true },
      ["playerId"],
    );
  }

  /** 저장된 매치로 tracked_players 커버리지(최소/최대 시각·건수·갱신시각) 갱신. */
  private async updateCoverage(playerId: string, markBackfilled = false): Promise<void> {
    const agg = await this.pmRepo
      .createQueryBuilder("pm")
      .select("MIN(pm.playedAt)", "oldest")
      .addSelect("MAX(pm.playedAt)", "newest")
      .addSelect("COUNT(*)", "cnt")
      .where("pm.playerId = :pid", { pid: playerId })
      .getRawOne<{ oldest: Date | null; newest: Date | null; cnt: string }>();
    await this.tpRepo.update(
      { playerId },
      {
        oldestPlayedAt: agg?.oldest ?? null,
        newestPlayedAt: agg?.newest ?? null,
        matchCount: n(agg?.cnt),
        lastRefreshedAt: new Date(),
        ...(markBackfilled ? { backfilled: true } : {}),
      },
    );
  }

  /**
   * 프로필 조회 훅: watchlist 등록 + 최근분 적립. 요청을 실패시키지 않도록 예외를 흡수한다.
   * (첫 조회는 전체 백필로 현 시즌을 한 번에 확보 — 무겁지만 fire-and-forget 백그라운드 요청)
   */
  async syncOnView(playerId: string, nickname?: string | null): Promise<any> {
    try {
      await this.ensureReady();
      // 첫 조회면 전체 백필(현 시즌 전체), 이미 백필됐으면 최근분만 갱신.
      const existing = await this.tpRepo.findOne({ where: { playerId } });
      const full = !existing?.backfilled;
      // 조회 폭주 방지: 백필 완료 + 최근 30분 내 갱신이면 Neople/DB 작업 없이 즉시 반환.
      if (
        !full &&
        existing?.lastRefreshedAt &&
        Date.now() - new Date(existing.lastRefreshedAt).getTime() < 30 * 60 * 1000
      ) {
        return { tracked: true, mode: "cached", ingested: 0 };
      }
      await this.track(playerId, nickname, "search");
      let ingested = 0;
      // 공식전(rating) + 일반전(normal) 둘 다 적립.
      for (const gt of ["rating", "normal"]) {
        ingested += full ? await this.ingestFull(playerId, gt) : await this.ingestRecent(playerId, gt);
      }
      await this.updateCoverage(playerId, full);
      // 궁극기(1차/2차) 판별은 매치 상세 호출이 필요해 오래 걸리므로 기다리지 않고 뒤에서 처리
      void this.playerUltimates
        .resolveForPlayer(playerId)
        .catch((e) => this.logger.warn(`궁극기 판별 실패(무시) ${playerId}: ${(e as Error).message}`));
      return { tracked: true, mode: full ? "full" : "recent", ingested };
    } catch (e) {
      this.logger.warn(`syncOnView 실패(무시) ${playerId}: ${(e as Error).message}`);
      return { tracked: false, error: (e as Error).message };
    }
  }

  /**
   * 수동 배치(관리자): watchlist 회전 갱신(물량 상한).
   *  1) 미백필(신규) 대상 전체 백필 — createdAt 오래된 순, backfillLimit 명.
   *  2) 백필된 대상 최근분 갱신 — lastRefreshedAt 오래된 순, refreshLimit 명.
   */
  async refreshWatchlist(opts: { backfillLimit?: number; refreshLimit?: number } = {}): Promise<any> {
    await this.ensureReady();
    const backfillLimit = Math.min(Math.max(Math.floor(opts.backfillLimit ?? 8) || 8, 0), 100);
    const refreshLimit = Math.min(Math.max(Math.floor(opts.refreshLimit ?? 25) || 25, 0), 300);

    let backfilled = 0;
    let backfillRows = 0;
    const toBackfill = await this.tpRepo.find({
      where: { active: true, backfilled: false },
      order: { createdAt: "ASC" },
      take: backfillLimit,
    });
    for (const tp of toBackfill) {
      try {
        for (const gt of ["rating", "normal"]) backfillRows += await this.ingestFull(tp.playerId, gt);
        await this.updateCoverage(tp.playerId, true);
        backfilled++;
      } catch (e) {
        this.logger.warn(`backfill 실패 ${tp.playerId}: ${(e as Error).message}`);
      }
    }

    let refreshed = 0;
    let refreshRows = 0;
    const toRefresh = await this.tpRepo.find({
      where: { active: true, backfilled: true },
      order: { lastRefreshedAt: "ASC" },
      take: refreshLimit,
    });
    for (const tp of toRefresh) {
      try {
        for (const gt of ["rating", "normal"]) refreshRows += await this.ingestRecent(tp.playerId, gt);
        await this.updateCoverage(tp.playerId);
        refreshed++;
      } catch (e) {
        this.logger.warn(`refresh 실패 ${tp.playerId}: ${(e as Error).message}`);
      }
    }

    const result = { backfilled, backfillRows, refreshed, refreshRows, backfillLimit, refreshLimit };
    this.logger.log(`refreshWatchlist: ${JSON.stringify(result)}`);
    // 새로 쌓인 경기의 궁극기 판별 — 매치 상세는 현재 시즌만 남으므로 적립 직후 뒤에서 바로 처리
    void this.playerUltimates
      .resolvePending()
      .catch((e) => this.logger.warn(`궁극기 판별 배치 실패(무시): ${(e as Error).message}`));
    return result;
  }

  // ---------------------------------------------------------------- 분석/조회

  /**
   * 적립된 개인 매치로 요약(총합/승률/주력캐릭/포지션/연도별/최근폼) 산출.
   * 기존 포지션 필드(positions/primaryRole/byYear.topRole/topCharacters.role)는 그대로 유지하고,
   * 공식 역할군 필드(officialPositions/primaryOfficialRole/byYear.topOfficialRole/topCharacters.ultimates)를 추가한다.
   * officialRole=null 은 "미확정"(1차·2차 역할군이 다른 캐릭터인데 궁극기를 아직 모르는 판)이다.
   * @param playerId — 대상 플레이어 ID
   * @param gameType — "rating"(기본) | "normal" | "all"(공식전+일반전 합산)
   *   all 은 일반전에 승패·KDA 가 없으므로 승률·KDA 는 승패가 있는 판(공식전)만으로 계산하고,
   *   판 수·캐릭터·역할 성향은 두 타입을 합쳐 계산한다.
   * @returns 개인 분석 요약 객체
   */
  async summary(playerId: string, gameType = "rating"): Promise<any> {
    await this.ensureReady();
    await this.ultimates.ensureReady();
    const all = gameType === "all";
    const rows = await this.pmRepo.find({
      where: { playerId, gameTypeId: all ? In(["rating", "normal"]) : gameType },
      select: ["matchId", "playedAt", "characterId", "characterName", "result", "killCount", "deathCount", "assistCount", "playTime", "ultimateType", "ultimateCheckedAt"],
      order: { playedAt: "DESC" },
    });

    const total = rows.length;
    const wins = rows.filter((r) => r.result === "win").length;
    const losses = rows.filter((r) => r.result === "lose").length;
    const decided = wins + losses; // 승패가 있는 경기(일반전은 0)
    const winRate = decided ? Math.round((wins / decided) * 1000) / 10 : 0;
    let playTimeSum = 0;
    let playTimeCnt = 0;
    /**
     * 승률(%) — all 이면 승패가 있는 판(dec)만 분모로, 그 외는 기존대로 전체 판(games)을 분모로.
     * @param w — 승리 수
     * @param games — 판 수
     * @param dec — 승패가 있는 판 수
     */
    const rate = (w: number, games: number, dec: number): number => {
      const denom = all ? dec : games;
      return denom ? Math.round((w / denom) * 1000) / 10 : 0;
    };

    const charMap = new Map<string, { characterId: string; games: number; wins: number; dec: number; k: number; d: number; a: number }>();
    const roleMap = new Map<string, { games: number; wins: number; dec: number }>();
    // 공식 역할군 집계 — 키 null = 미확정
    const officialMap = new Map<string | null, { games: number; wins: number; dec: number }>();
    // 캐릭터별 1차/2차/미상 판 수
    const ultByChar = new Map<string, { first: number; second: number; unknown: number }>();
    let ultChecked = 0;
    const yearMap = new Map<
      number,
      { games: number; wins: number; dec: number; chars: Map<string, number>; roles: Map<string, number>; officialRoles: Map<string, number> }
    >();
    let kSum = 0;
    let dSum = 0;
    let aSum = 0;

    for (const r of rows) {
      const name = r.characterName ?? "미상";
      const role = classifyRole(name);
      const win = r.result === "win" ? 1 : 0;
      // 승패가 있는 판(공식전). all 모드에서는 이 판만 승률·KDA 에 넣는다(일반전은 KDA 가 0 으로 저장됨)
      const dec = r.result === "win" || r.result === "lose" ? 1 : 0;
      const kdaOk = !all || dec === 1;
      if (r.playTime) {
        playTimeSum += r.playTime;
        playTimeCnt++;
      }
      if (kdaOk) {
        kSum += r.killCount;
        dSum += r.deathCount;
        aSum += r.assistCount;
      }

      const c = charMap.get(name) ?? { characterId: "", games: 0, wins: 0, dec: 0, k: 0, d: 0, a: 0 };
      if (!c.characterId && r.characterId) c.characterId = String(r.characterId);
      c.games++;
      c.wins += win;
      c.dec += dec;
      if (kdaOk) {
        c.k += r.killCount;
        c.d += r.deathCount;
        c.a += r.assistCount;
      }
      charMap.set(name, c);

      const rl = roleMap.get(role) ?? { games: 0, wins: 0, dec: 0 };
      rl.games++;
      rl.wins += win;
      rl.dec += dec;
      roleMap.set(role, rl);

      // 공식 역할군: 궁극기를 알면 그 역할군, 몰라도 역할군이 하나로 정해지면 그 역할군, 아니면 미확정(null)
      const officialRole = this.ultimates.officialRoleOf(String(r.characterId), r.ultimateType);
      const ol = officialMap.get(officialRole) ?? { games: 0, wins: 0, dec: 0 };
      ol.games++;
      ol.wins += win;
      ol.dec += dec;
      officialMap.set(officialRole, ol);
      if (r.ultimateCheckedAt) ultChecked++;
      const us = ultByChar.get(name) ?? { first: 0, second: 0, unknown: 0 };
      if (r.ultimateType === "1st") us.first++;
      else if (r.ultimateType === "2nd") us.second++;
      else us.unknown++;
      ultByChar.set(name, us);

      if (r.playedAt) {
        const y = kstYear(r.playedAt); // 연도 경계도 한국 시간 기준(서버 UTC 무관)
        const ye = yearMap.get(y) ?? { games: 0, wins: 0, dec: 0, chars: new Map(), roles: new Map(), officialRoles: new Map() };
        ye.games++;
        ye.wins += win;
        ye.dec += dec;
        ye.chars.set(name, (ye.chars.get(name) ?? 0) + 1);
        ye.roles.set(role, (ye.roles.get(role) ?? 0) + 1);
        if (officialRole) ye.officialRoles.set(officialRole, (ye.officialRoles.get(officialRole) ?? 0) + 1);
        yearMap.set(y, ye);
      }
    }

    const topOf = (m: Map<string, number>): string | null => {
      let best: string | null = null;
      let bestN = -1;
      for (const [k, v] of m) if (v > bestN) ((bestN = v), (best = k));
      return best;
    };

    const topCharacters = [...charMap.entries()]
      .map(([name, s]) => ({
        name,
        characterId: s.characterId,
        role: classifyRole(name),
        games: s.games,
        wins: s.wins,
        // 승패가 있는 판 수(공식전). all 모드에서 승률의 분모 — 화면에 "공식 N전 W승"으로 표시
        decided: s.dec,
        winRate: rate(s.wins, s.games, s.dec),
        kda: s.d ? Math.round(((s.k + s.a) / s.d) * 100) / 100 : s.k + s.a,
        // 1차/2차/미상 판 수 (공식 역할군 체계용, 기존 필드와 별개)
        ultimates: ultByChar.get(name) ?? { first: 0, second: 0, unknown: s.games },
        // 이 캐릭터의 대표 공식 역할군 — 궁극기와 무관하게 정해지면 그 값, 아니면 더 많이 쓴 궁극기의 역할군
        officialRole: this.charOfficialRole(s.characterId, ultByChar.get(name)),
      }))
      .sort((x, y) => y.games - x.games)
      .slice(0, 8);

    const positions = [...roleMap.entries()]
      .map(([role, s]) => ({
        role,
        games: s.games,
        share: total ? Math.round((s.games / total) * 1000) / 10 : 0,
        winRate: rate(s.wins, s.games, s.dec),
      }))
      .sort((x, y) => y.games - x.games);

    const byYear = [...yearMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([year, s]) => ({
        year,
        games: s.games,
        winRate: rate(s.wins, s.games, s.dec),
        topCharacter: topOf(s.chars),
        topRole: topOf(s.roles),
        topOfficialRole: topOf(s.officialRoles), // 미확정 제외 최다 공식 역할군
      }));

    // 공식 역할군 분포 — 미확정(null)은 목록 끝에 둔다
    const officialPositions = [...officialMap.entries()]
      .map(([officialRole, s]) => ({
        officialRole,
        games: s.games,
        share: total ? Math.round((s.games / total) * 1000) / 10 : 0,
        winRate: rate(s.wins, s.games, s.dec),
      }))
      .sort((x, y) => (x.officialRole === null ? 1 : 0) - (y.officialRole === null ? 1 : 0) || y.games - x.games);
    const primaryOfficialRole = officialPositions.find((p) => p.officialRole !== null)?.officialRole ?? null;

    const recentForm = rows
      .filter((r) => r.result === "win" || r.result === "lose")
      .slice(0, 10)
      .map((r) => (r.result === "win" ? "win" : "lose"));
    const primaryRole = positions[0]?.role ?? null;

    return {
      playerId,
      gameType,
      coverage: {
        total,
        oldest: rows[total - 1]?.playedAt ?? null,
        newest: rows[0]?.playedAt ?? null,
        // 궁극기 판별을 마친 판 수 / 아직 백그라운드 처리 대기 중인 판 수
        ultimateChecked: ultChecked,
        ultimatePending: total - ultChecked,
      },
      winRate,
      wins,
      losses,
      decided,
      avgKda: dSum ? Math.round(((kSum + aSum) / dSum) * 100) / 100 : kSum + aSum,
      avgPlayTime: playTimeCnt ? Math.round(playTimeSum / playTimeCnt) : 0,
      primaryRole,
      positions,
      primaryOfficialRole,
      officialPositions,
      topCharacters,
      byYear,
      recentForm,
    };
  }

  /**
   * 캐릭터의 대표 공식 역할군(주력 캐릭터 표시용).
   * @param characterId — 캐릭터 ID
   * @param u — 이 플레이어의 그 캐릭터 1차/2차/미상 판 수
   * @returns 역할군이 궁극기와 무관하게 정해지면 그 값, 아니면 판별된 판이 더 많은 궁극기의 역할군, 판별이 없으면 null
   */
  private charOfficialRole(characterId: string, u?: { first: number; second: number; unknown: number }): string | null {
    const fixed = this.ultimates.officialRoleOf(characterId, null);
    if (fixed) return fixed;
    if (!u || u.first + u.second === 0) return null;
    return this.ultimates.officialRoleOf(characterId, u.second > u.first ? "2nd" : "1st");
  }

  /** 적립된 원본 매치(최근순) 조회 — 디버그/검증용. */
  async listMatches(playerId: string, limit = 50): Promise<PlayerMatch[]> {
    await this.ensureReady();
    const take = Math.min(Math.max(Math.floor(limit) || 50, 1), 200);
    return this.pmRepo.find({ where: { playerId }, order: { playedAt: "DESC" }, take });
  }

  /** 적립 현황/용량 통계 — 관리자 모니터링(512MB 안전장치). */
  async storageStats(): Promise<any> {
    await this.ensureReady();
    const [trackedPlayers, backfilled, storedMatches] = await Promise.all([
      this.tpRepo.count(),
      this.tpRepo.count({ where: { backfilled: true } }),
      this.pmRepo.count(),
    ]);
    let playerMatchesBytes: number | null = null;
    try {
      const r = await this.dataSource.query(`SELECT pg_total_relation_size('player_matches') AS s`);
      playerMatchesBytes = n(r?.[0]?.s);
    } catch {
      /* 무시 */
    }
    return { trackedPlayers, backfilled, pendingBackfill: trackedPlayers - backfilled, storedMatches, playerMatchesBytes };
  }
}
