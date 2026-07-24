import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { Match, MatchPlayer, CollectionState } from "../database/entities";
import { classifyRole } from "./character-roles";
import { NeopleService } from "../neople/neople.service";

/* eslint-disable @typescript-eslint/no-explicit-any */

@Injectable()
export class MetaService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Match) private readonly matchRepo: Repository<Match>,
    @InjectRepository(MatchPlayer) private readonly mpRepo: Repository<MatchPlayer>,
    @InjectRepository(CollectionState) private readonly stateRepo: Repository<CollectionState>,
    private readonly neople: NeopleService,
  ) {}

  /** 전체 캐릭터 로스터 (역할 포함) — 투표 캐릭터 선택 UI 용. */
  async roster() {
    const raw: any = await this.neople.proxy("/characters");
    const rows: any[] = Array.isArray(raw?.rows) ? raw.rows : Array.isArray(raw) ? raw : [];
    return rows
      .map((r) => ({
        characterId: String(r?.characterId ?? ""),
        characterName: r?.characterName ?? null,
        role: classifyRole(r?.characterName),
      }))
      .filter((r) => r.characterId);
  }

  async summary() {
    const matches = await this.matchRepo.count();
    const playerRecords = await this.mpRepo.count();
    const c = await this.dataSource.query(
      `SELECT count(distinct "characterId")::int AS c FROM match_players`,
    );
    const state = await this.stateRepo.findOne({ where: { key: "meta_collect" } });
    return {
      matches,
      playerRecords,
      characters: c[0]?.c ?? 0,
      lastCollect: state?.value ?? null,
    };
  }

  async characterStats(gameTypeId?: string) {
    const params: any[] = [];
    let where = "";
    if (gameTypeId) {
      where = `WHERE "gameTypeId" = $1`;
      params.push(gameTypeId);
    }
    const rows: any[] = await this.dataSource.query(
      `
      SELECT "characterId",
             max("characterName") AS "characterName",
             count(*)::int AS picks,
             count(distinct "matchId")::int AS "matchCount",
             sum(CASE WHEN result = 'win' THEN 1 ELSE 0 END)::int AS wins,
             round(avg("killCount")::numeric, 2)::float AS "avgKill",
             round(avg("deathCount")::numeric, 2)::float AS "avgDeath",
             round(avg("assistCount")::numeric, 2)::float AS "avgAssist"
      FROM match_players ${where}
      GROUP BY "characterId"
      ORDER BY picks DESC
      `,
      params,
    );
    const totalRow: any[] = await this.dataSource.query(
      `SELECT count(distinct "matchId")::int AS t FROM match_players ${where}`,
      params,
    );
    const totalMatches = totalRow[0]?.t || 1;

    return rows.map((r) => ({
      characterId: r.characterId,
      characterName: r.characterName,
      role: classifyRole(r.characterName),
      picks: r.picks,
      matchCount: r.matchCount,
      wins: r.wins,
      pickRate: Math.round((r.matchCount / totalMatches) * 1000) / 10,
      winRate: Math.round((r.wins / r.picks) * 1000) / 10,
      kda: Math.round(((r.avgKill + r.avgAssist) / Math.max(r.avgDeath, 1)) * 100) / 100,
      avgKill: r.avgKill,
      avgDeath: r.avgDeath,
      avgAssist: r.avgAssist,
    }));
  }

  async characterItems(characterId: string) {
    const picks = await this.mpRepo.count({ where: { characterId } });
    const rows: any[] = await this.dataSource.query(
      `
      SELECT it->>'itemId' AS "itemId",
             max(it->>'itemName') AS "itemName",
             max(it->>'slotName') AS "slotName",
             max(it->>'slotCode') AS "slotCode",
             max(it->>'equipSlotCode') AS "equipSlotCode",
             max(it->>'rarityCode') AS "rarityCode",
             count(*)::int AS cnt
      FROM match_players mp, jsonb_array_elements(mp.items) it
      WHERE mp."characterId" = $1
        AND mp.items IS NOT NULL
        AND jsonb_typeof(mp.items) = 'array'
      GROUP BY it->>'itemId'
      ORDER BY cnt DESC
      `,
      [characterId],
    );

    const rate = (cnt: number) => (picks ? Math.round((cnt / picks) * 1000) / 10 : 0);

    // 슬롯(부위)별 그룹 — equipSlotCode 기준
    const slotMap = new Map<
      string,
      {
        equipSlotCode: string;
        slotCode: string | null;
        slotName: string | null;
        items: { itemId: string; itemName: string | null; rarityCode: string | null; count: number; rate: number }[];
      }
    >();
    for (const r of rows) {
      const key = r.equipSlotCode ?? r.slotCode ?? r.slotName ?? "etc";
      let slot = slotMap.get(key);
      if (!slot) {
        slot = {
          equipSlotCode: r.equipSlotCode ?? r.slotCode ?? "",
          slotCode: r.slotCode ?? null,
          slotName: r.slotName ?? null,
          items: [],
        };
        slotMap.set(key, slot);
      }
      slot.items.push({
        itemId: r.itemId,
        itemName: r.itemName,
        rarityCode: r.rarityCode ?? null,
        count: r.cnt,
        rate: rate(r.cnt),
      });
    }
    const slots = [...slotMap.values()]
      .map((s) => ({ ...s, items: s.items.sort((a, b) => b.count - a.count) }))
      .sort((a, b) => (a.equipSlotCode < b.equipSlotCode ? -1 : a.equipSlotCode > b.equipSlotCode ? 1 : 0));

    return {
      characterId,
      picks,
      slots,
      items: rows.slice(0, 24).map((r) => ({
        itemId: r.itemId,
        itemName: r.itemName,
        slotName: r.slotName,
        rarityCode: r.rarityCode ?? null,
        count: r.cnt,
        rate: rate(r.cnt),
      })),
    };
  }

  /**
   * 팀 조합(풀팀) 집계.
   * 팀 = 같은 매치에서 결과(win/lose)가 같은 플레이어들의 캐릭터 집합.
   * 표준 팀 인원(데이터상 최빈값, 보통 5)을 '풀팀'으로 보고 그 크기의 조합만 집계한다.
   * 빈도(등장 팀 수)와 승률(win 팀 비율)을 함께 반환한다.
   */
  async compositions(opts: { gameTypeId?: string; limit?: number; minGames?: number } = {}) {
    const gameTypeId = opts.gameTypeId ?? "rating";
    const limit = Math.min(Math.max(opts.limit ?? 6, 1), 30);
    const minGames = Math.max(opts.minGames ?? 3, 1);

    // 매치×결과 단위로 팀을 복원. 캐릭터명 기준 정렬로 같은 조합은 동일 순서 보장.
    const teams: Array<{ ids: string[]; names: string[]; size: number; result: string }> =
      await this.dataSource.query(
        `
        SELECT array_agg("characterId" ORDER BY "characterName") AS ids,
               array_agg("characterName" ORDER BY "characterName") AS names,
               count(*)::int AS size,
               result
        FROM match_players
        WHERE result IN ('win', 'lose')
          AND "characterName" IS NOT NULL
          AND "gameTypeId" = $1
        GROUP BY "matchId", result
        `,
        [gameTypeId],
      );

    // 풀팀 크기 = 팀 인원 최빈값
    const sizeCount = new Map<number, number>();
    for (const t of teams) sizeCount.set(t.size, (sizeCount.get(t.size) ?? 0) + 1);
    let teamSize = 5;
    let best = -1;
    for (const [size, n] of sizeCount) {
      if (n > best) {
        best = n;
        teamSize = size;
      }
    }

    // 풀팀만 조합 시그니처로 집계
    const combos = new Map<
      string,
      { ids: string[]; names: string[]; games: number; wins: number }
    >();
    let fullTeams = 0;
    for (const t of teams) {
      if (t.size !== teamSize) continue;
      fullTeams++;
      const sig = t.ids.join("-");
      let entry = combos.get(sig);
      if (!entry) {
        entry = { ids: t.ids, names: t.names, games: 0, wins: 0 };
        combos.set(sig, entry);
      }
      entry.games++;
      if (t.result === "win") entry.wins++;
    }

    const all = [...combos.values()].map((c) => ({
      ids: c.ids,
      names: c.names,
      games: c.games,
      wins: c.wins,
      winRate: c.games ? Math.round((c.wins / c.games) * 1000) / 10 : 0,
    }));

    const byFrequency = [...all]
      .sort((a, b) => b.games - a.games || b.winRate - a.winRate)
      .slice(0, limit);

    const byWinRate = all
      .filter((c) => c.games >= minGames)
      .sort((a, b) => b.winRate - a.winRate || b.games - a.games)
      .slice(0, limit);

    return {
      gameTypeId,
      teamSize,
      totalTeams: fullTeams,
      distinctCombos: combos.size,
      minGames,
      byFrequency,
      byWinRate,
    };
  }

  /**
   * 특정 캐릭터의 표본 픽 기록 — "누가(닉네임) 어떤 경기에서 픽했는지".
   * match_players 에서 해당 캐릭터 행을 최신순으로 반환(+매치 메타).
   */
  async characterPicks(characterId: string, gameTypeId?: string, limitInput = 30) {
    const limit = Math.min(Math.max(Math.floor(limitInput) || 30, 1), 100);
    const params: any[] = [characterId];
    let gt = "";
    if (gameTypeId) {
      gt = `AND mp."gameTypeId" = $2`;
      params.push(gameTypeId);
    }
    params.push(limit);
    const rows: any[] = await this.dataSource.query(
      `
      SELECT mp."matchId", mp."playerId", mp.nickname, mp.result,
             mp."killCount", mp."deathCount", mp."assistCount",
             m."playedAt", m."mapName"
      FROM match_players mp
      LEFT JOIN matches m ON m."matchId" = mp."matchId"
      WHERE mp."characterId" = $1 ${gt}
      ORDER BY m."playedAt" DESC NULLS LAST
      LIMIT $${params.length}
      `,
      params,
    );
    const total = await this.mpRepo.count({
      where: gameTypeId ? { characterId, gameTypeId } : { characterId },
    });
    return {
      characterId,
      total,
      picks: rows.map((r) => ({
        matchId: r.matchId,
        playerId: r.playerId,
        nickname: r.nickname,
        result: r.result,
        killCount: r.killCount,
        deathCount: r.deathCount,
        assistCount: r.assistCount,
        playedAt: r.playedAt,
        mapName: r.mapName,
      })),
    };
  }

  /**
   * 특정 조합(캐릭터ID 집합)이 등장한 표본 매치 목록 + 그 팀 멤버.
   * 같은 매치·같은 결과(win/lose)의 플레이어 캐릭터 집합이 요청 집합과 정확히 일치하는 팀만.
   */
  async compositionMatches(idsCsv: string, gameTypeId?: string, limitInput = 20) {
    const gt = gameTypeId ?? "rating";
    const ids = [...new Set(idsCsv.split(",").map((x) => x.trim()).filter(Boolean))];
    if (ids.length < 2) return { ids, gameTypeId: gt, matches: [] };
    const n = ids.length;
    const limit = Math.min(Math.max(Math.floor(limitInput) || 20, 1), 50);

    const teams: Array<{ matchId: string; result: string }> = await this.dataSource.query(
      `
      SELECT "matchId", result
      FROM match_players
      WHERE result IN ('win','lose') AND "characterName" IS NOT NULL AND "gameTypeId" = $1
      GROUP BY "matchId", result
      HAVING count(*) = $2
         AND count(*) FILTER (WHERE "characterId" = ANY($3::text[])) = $2
      LIMIT $4
      `,
      [gt, n, ids, limit],
    );
    if (teams.length === 0) return { ids, gameTypeId: gt, matches: [] };

    const resultByMatch = new Map(teams.map((t) => [t.matchId, t.result]));
    const matchIds = teams.map((t) => t.matchId);
    const players: any[] = await this.dataSource.query(
      `
      SELECT mp."matchId", mp.result, mp."playerId", mp.nickname,
             mp."characterId", mp."characterName",
             mp."killCount", mp."deathCount", mp."assistCount",
             m."playedAt", m."mapName"
      FROM match_players mp
      LEFT JOIN matches m ON m."matchId" = mp."matchId"
      WHERE mp."matchId" = ANY($1::text[])
      `,
      [matchIds],
    );

    const byMatch = new Map<string, any>();
    for (const p of players) {
      if (resultByMatch.get(p.matchId) !== p.result) continue; // 이 조합의 팀만
      let g = byMatch.get(p.matchId);
      if (!g) {
        g = {
          matchId: p.matchId,
          result: p.result,
          playedAt: p.playedAt,
          mapName: p.mapName,
          players: [],
        };
        byMatch.set(p.matchId, g);
      }
      g.players.push({
        playerId: p.playerId,
        nickname: p.nickname,
        characterId: p.characterId,
        characterName: p.characterName,
        killCount: p.killCount,
        deathCount: p.deathCount,
        assistCount: p.assistCount,
      });
    }
    const matches = [...byMatch.values()].sort(
      (a, b) =>
        (b.playedAt ? new Date(b.playedAt).getTime() : 0) -
        (a.playedAt ? new Date(a.playedAt).getTime() : 0),
    );
    return { ids, gameTypeId: gt, matches };
  }
}
