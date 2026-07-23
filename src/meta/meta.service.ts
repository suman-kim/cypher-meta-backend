import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { Match, MatchPlayer, CollectionState } from "../database/entities";

/* eslint-disable @typescript-eslint/no-explicit-any */

@Injectable()
export class MetaService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Match) private readonly matchRepo: Repository<Match>,
    @InjectRepository(MatchPlayer) private readonly mpRepo: Repository<MatchPlayer>,
    @InjectRepository(CollectionState) private readonly stateRepo: Repository<CollectionState>,
  ) {}

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
    const total = rows.reduce((s, r) => s + r.picks, 0) || 1;
    return rows.map((r) => ({
      characterId: r.characterId,
      characterName: r.characterName,
      picks: r.picks,
      wins: r.wins,
      pickRate: Math.round((r.picks / total) * 1000) / 10,
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
             count(*)::int AS cnt
      FROM match_players mp, jsonb_array_elements(mp.items) it
      WHERE mp."characterId" = $1
        AND mp.items IS NOT NULL
        AND jsonb_typeof(mp.items) = 'array'
      GROUP BY it->>'itemId'
      ORDER BY cnt DESC
      LIMIT 24
      `,
      [characterId],
    );
    return {
      characterId,
      picks,
      items: rows.map((r) => ({
        itemId: r.itemId,
        itemName: r.itemName,
        slotName: r.slotName,
        count: r.cnt,
        rate: picks ? Math.round((r.cnt / picks) * 1000) / 10 : 0,
      })),
    };
  }
}
