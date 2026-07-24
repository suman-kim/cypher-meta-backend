/**
 * meta.service.ts
 * ---------------------------------------------------------------------------
 * 사이퍼즈(Cyphers) 메타 통계 서비스.
 *
 * 수집된 매치/플레이어 데이터(match_players, matches)와 수집 상태(collection_state)를
 * 바탕으로 프론트엔드에 노출할 각종 메타 지표를 계산해 반환한다.
 *  - 전체 캐릭터 로스터(roster)
 *  - 수집 현황 요약(summary)
 *  - 캐릭터별 픽/승률/KDA 통계(characterStats)
 *  - 캐릭터별 아이템 채용률(characterItems)
 *  - 팀 조합(풀팀) 빈도/승률 집계(compositions)
 *  - 특정 캐릭터 픽 표본(characterPicks)
 *  - 특정 조합 등장 매치 표본(compositionMatches)
 *
 * 대부분의 집계는 TypeORM Repository 대신 DataSource 를 통한 원시 SQL 로 수행한다.
 * 외부 캐릭터 목록은 NeopleService(네오플 오픈 API 프록시)에서 가져온다.
 */
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { Match, MatchPlayer, CollectionState, CollectionRun } from "../database/entities";
import { classifyRole } from "./character-roles";
import { CollectionConfigService } from "./collection-config.service";
import { NeopleService } from "../neople/neople.service";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 사이퍼즈 메타 통계 서비스 클래스.
 * 매치/플레이어 데이터를 조회·집계해 메타 관련 API 응답 데이터를 생성한다.
 */
@Injectable()
export class MetaService {
  /**
   * 의존성 주입 생성자.
   * @param dataSource — TypeORM DataSource. 원시 SQL 집계 쿼리 실행에 사용한다.
   * @param matchRepo — Match 엔티티 리포지토리(매치 단위 데이터 접근).
   * @param mpRepo — MatchPlayer 엔티티 리포지토리(매치 내 플레이어 단위 데이터 접근).
   * @param stateRepo — CollectionState 엔티티 리포지토리(수집 상태/커서 저장소).
   * @param neople — 네오플 오픈 API 프록시 서비스(외부 캐릭터 목록 등 조회).
   */
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Match) private readonly matchRepo: Repository<Match>,
    @InjectRepository(MatchPlayer) private readonly mpRepo: Repository<MatchPlayer>,
    @InjectRepository(CollectionState) private readonly stateRepo: Repository<CollectionState>,
    @InjectRepository(CollectionRun) private readonly runRepo: Repository<CollectionRun>,
    private readonly collectionConfig: CollectionConfigService,
    private readonly neople: NeopleService,
  ) {}

  /**
   * 전체 캐릭터 로스터 (역할 포함) — 투표 캐릭터 선택 UI 용.
   * 네오플 API의 /characters 응답을 정규화하고 캐릭터명으로 역할(role)을 분류한다.
   * @returns { characterId, characterName, role } 배열 (characterId 가 있는 항목만).
   */
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

  /**
   * 수집 현황 요약.
   * 저장된 매치 수·플레이어 레코드 수·등장 캐릭터 수와, 마지막 수집/회전 커서 상태를
   * 취합해 사용자 노출용 집계 범위(scope)를 함께 반환한다.
   * @returns 매치/레코드/캐릭터 수와 마지막 수집 정보 및 집계 범위(scope) 객체.
   */
  async summary() {
    const matches = await this.matchRepo.count();
    const playerRecords = await this.mpRepo.count();
    const c = await this.dataSource.query(
      `SELECT count(distinct "characterId")::int AS c FROM match_players`,
    );

    // 설정(collection_config)과 가장 최근 수집 이력(collection_run)에서 집계 범위/진행도를 도출한다.
    // 실패하더라도 요약 자체는 항상 반환되도록 방어적으로 처리한다.
    try {
      const cfg = await this.collectionConfig.getConfig();
      const lastRun = await this.runRepo.findOne({ where: {}, order: { id: "DESC" } });
      const rotating = cfg.mode === "rotating";
      const rankTop = rotating ? cfg.maxRank : cfg.rankers;
      const window = rotating ? cfg.cronWindow : cfg.rankers;

      const lastCollect = lastRun
        ? {
            lastRun: (lastRun.finishedAt ?? lastRun.startedAt)?.toISOString?.() ?? null,
            rankers: lastRun.windowSize,
            perPlayer: lastRun.perPlayer,
            gameTypeId: lastRun.gameType,
            scanned: lastRun.scanned,
            collected: lastRun.collected,
            trigger: lastRun.trigger,
            source: lastRun.source,
            status: lastRun.status,
            rankFrom: lastRun.rankFrom,
            rankTo: lastRun.rankTo,
          }
        : null;

      return {
        matches,
        playerRecords,
        characters: c[0]?.c ?? 0,
        lastCollect,
        // 집계 범위/진행도(사용자 노출용). rankTop 은 rotating=순회 상한(maxRank), fixed=상위 rankers.
        scope: {
          mode: cfg.mode,
          gameType: cfg.gameType,
          perPlayer: cfg.perPlayer,
          rankTop,
          rotating,
          window,
          cursorOffset: cfg.cursorOffset, // 다음에 수집할 프론티어(0~maxRank)
          lastCollectedOffset: rotating && lastRun ? lastRun.offset : null, // 방금 수집한 구간 시작
        },
      };
    } catch {
      // 설정 테이블 준비 전 등 예외 시: 범위 정보 없이 카운트만 반환.
      return {
        matches,
        playerRecords,
        characters: c[0]?.c ?? 0,
        lastCollect: null,
        scope: null,
      };
    }
  }

  /**
   * 캐릭터별 픽/승률/KDA 통계 집계.
   * match_players 를 캐릭터 단위로 그룹핑해 픽 수·승수·평균 킬/데스/어시 등을 계산하고,
   * 전체 매치 수 대비 픽률과 승률·KDA 를 파생 계산한다.
   * @param gameTypeId — 게임 타입 필터(예: "rating"). 지정하면 해당 타입만 집계, 미지정 시 전체.
   * @returns 캐릭터별 통계 객체 배열(픽 수 내림차순 정렬).
   */
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

  /**
   * 특정 캐릭터의 아이템 채용 통계.
   * 해당 캐릭터의 items(JSONB 배열)를 펼쳐 아이템별 채용 횟수를 집계하고,
   * 픽 수 대비 채용률(rate)을 계산해 슬롯(부위)별 그룹과 상위 아이템 목록을 반환한다.
   * @param characterId — 통계를 낼 캐릭터 ID.
   * @returns { characterId, picks(픽 수), slots(부위별 아이템 그룹), items(상위 24개 아이템) }.
   */
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

    // 픽 수 대비 채용률(%) 계산 헬퍼. 픽이 없으면 0 반환.
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
   *
   * @param opts — 집계 옵션 객체.
   * @param opts.gameTypeId — 게임 타입 필터(미지정 시 "rating").
   * @param opts.limit — 반환할 조합 수(1~30 로 클램프, 기본 6).
   * @param opts.minGames — byWinRate 산정 시 최소 표본 경기 수(1 이상, 기본 3).
   * @returns 게임타입·풀팀 크기·총 팀 수·고유 조합 수와, 빈도순/승률순 조합 목록.
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
    const combos = new Map<string, { ids: string[]; names: string[]; games: number; wins: number }>();
    let fullTeams = 0;
    for (const t of teams) {
      if (t.size !== teamSize) continue;
      fullTeams++;
      // 중복 판정 키(시그니처)를 캐릭터 이름 조합으로 사용한다.
      // (정렬도 이름순이므로, 같은 5명이면 항상 같은 이름 시그니처가 나온다)
      const sig = t.names.join("-");
      let entry = combos.get(sig);
      if (!entry) {
        entry = { ids: t.ids, names: t.names, games: 0, wins: 0 };
        combos.set(sig, entry);
      }
      entry.games++;
      if (t.result === "win") entry.wins++;
    }
    console.log(combos);

    // 조합 빈도 분포 요약 — "왜 빈도가 낮은지" 사용자에게 설명하기 위한 지표.
    // 조합 = 5명 전원이 정확히 같은 팀. 캐릭터 수가 많아 정확 일치가 드물어 대부분 1~2판이다.
    let repeatedCombos = 0; // 2판 이상 반복 등장한 서로 다른 조합 수
    let maxGames = 0; // 가장 많이 나온 조합의 판수
    for (const c of combos.values()) {
      if (c.games >= 2) repeatedCombos++;
      if (c.games > maxGames) maxGames = c.games;
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

    // 이 조합 통계가 도출된 표본 경기 수(win/lose 팀이 존재하는 고유 매치).
    const mrow: any[] = await this.dataSource.query(
      `SELECT count(distinct "matchId")::int AS m
         FROM match_players
        WHERE "gameTypeId" = $1 AND result IN ('win', 'lose')`,
      [gameTypeId],
    );
    const sampledMatches = mrow[0]?.m ?? 0;

    return {
      gameTypeId,
      teamSize,
      totalTeams: fullTeams,
      distinctCombos: combos.size,
      repeatedCombos,
      maxGames,
      sampledMatches,
      minGames,
      byFrequency,
      byWinRate,
    };
  }

  /**
   * 특정 캐릭터의 표본 픽 기록 — "누가(닉네임) 어떤 경기에서 픽했는지".
   * match_players 에서 해당 캐릭터 행을 최신순으로 반환(+매치 메타).
   *
   * @param characterId — 조회할 캐릭터 ID.
   * @param gameTypeId — 게임 타입 필터(선택). 지정 시 해당 타입만.
   * @param limitInput — 반환 표본 개수(1~100 로 클램프, 기본 30).
   * @returns { characterId, total(전체 픽 수), picks(표본 픽 목록) }.
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
   *
   * @param idsCsv — 쉼표로 구분된 캐릭터 ID 목록 문자열(중복/공백 제거 후 사용, 2개 미만이면 빈 결과).
   * @param gameTypeId — 게임 타입 필터(미지정 시 "rating").
   * @param limitInput — 반환 매치 개수(1~50 로 클램프, 기본 20).
   * @returns { ids(정규화된 ID 배열), gameTypeId, matches(매치별 멤버 포함 목록) }.
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
