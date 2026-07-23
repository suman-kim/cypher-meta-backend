import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { Match, MatchPlayer, CollectionState } from "../database/entities";
import { NeopleService } from "../neople/neople.service";

/* eslint-disable @typescript-eslint/no-explicit-any */

@Injectable()
export class MetaService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly neople: NeopleService,
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

    // 픽률 분모: 표본 전체의 고유 매치 수 (판 기준 등장률)
    const totalRow: any[] = await this.dataSource.query(
      `SELECT count(distinct "matchId")::int AS c FROM match_players ${where}`,
      params,
    );
    const totalMatches = totalRow[0]?.c || 1;

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
      ORDER BY "matchCount" DESC
      `,
      params,
    );
    return rows.map((r) => ({
      characterId: r.characterId,
      characterName: r.characterName,
      picks: r.picks,
      matchCount: r.matchCount,
      wins: r.wins,
      // 판 기준 등장률: 이 캐릭터가 등장한 매치 수 / 전체 매치 수
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
    // 매치 아이템에는 slotName이 없어 equipSlotCode(장착 위치)로 그룹화한다.
    const rows: any[] = await this.dataSource.query(
      `
      SELECT it->>'equipSlotCode' AS "equipSlotCode",
             it->>'slotCode' AS "slotCode",
             it->>'itemId' AS "itemId",
             max(it->>'itemName') AS "itemName",
             max(it->>'rarityCode') AS "rarityCode",
             count(*)::int AS cnt
      FROM match_players mp, jsonb_array_elements(mp.items) it
      WHERE mp."characterId" = $1
        AND mp.items IS NOT NULL
        AND jsonb_typeof(mp.items) = 'array'
      GROUP BY it->>'equipSlotCode', it->>'slotCode', it->>'itemId'
      ORDER BY cnt DESC
      `,
      [characterId],
    );

    const rate = (cnt: number) => (picks ? Math.round((cnt / picks) * 1000) / 10 : 0);

    // equipSlotCode 별 그룹
    const bySlot = new Map<string, any[]>();
    for (const r of rows) {
      const code = r.equipSlotCode ?? r.slotCode ?? "?";
      if (!bySlot.has(code)) bySlot.set(code, []);
      bySlot.get(code)!.push(r);
    }

    // 각 슬롯 대표 아이템으로 slotName 조회 (아이템 상세, 캐시). 키/네트워크 없으면 null.
    const topItemIds = [...bySlot.values()].map((items) => items[0]?.itemId).filter(Boolean);
    const slotNames = await this.resolveSlotNames(topItemIds);

    const slots = [...bySlot.entries()].map(([equipSlotCode, items]) => ({
      equipSlotCode,
      slotCode: items[0]?.slotCode ?? null,
      slotName: slotNames.get(items[0]?.itemId) ?? null,
      items: items.slice(0, 6).map((r) => ({
        itemId: r.itemId,
        itemName: r.itemName,
        rarityCode: r.rarityCode,
        count: r.cnt,
        rate: rate(r.cnt),
      })),
    }));

    // 평면 상위 목록(호환용)
    const items = rows.slice(0, 24).map((r) => ({
      itemId: r.itemId,
      itemName: r.itemName,
      slotName: slotNames.get(r.itemId) ?? null,
      rarityCode: r.rarityCode,
      count: r.cnt,
      rate: rate(r.cnt),
    }));

    return { characterId, picks, slots, items };
  }

  /** 아이템 상세(/battleitems/:id)에서 slotName 을 조회 (프록시 캐시 활용). 실패 시 생략. */
  private async resolveSlotNames(itemIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    await Promise.all(
      [...new Set(itemIds)].map(async (id) => {
        try {
          const detail: any = await this.neople.proxy(`/battleitems/${encodeURIComponent(id)}`);
          if (detail?.slotName) map.set(id, String(detail.slotName));
        } catch {
          /* 키/네트워크 없거나 조회 실패 — slotName 없이 진행 */
        }
      }),
    );
    return map;
  }
}
