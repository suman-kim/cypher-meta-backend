import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { Match, MatchPlayer, CollectionState } from "../database/entities";
import { NeopleService } from "../neople/neople.service";
import { parseMatchDetail } from "./match-parser";

/* eslint-disable @typescript-eslint/no-explicit-any */

@Injectable()
export class CollectorService {
  private readonly logger = new Logger(CollectorService.name);
  private running = false;

  constructor(
    private readonly neople: NeopleService,
    @InjectRepository(Match) private readonly matchRepo: Repository<Match>,
    @InjectRepository(MatchPlayer) private readonly mpRepo: Repository<MatchPlayer>,
    @InjectRepository(CollectionState) private readonly stateRepo: Repository<CollectionState>,
    private readonly dataSource: DataSource,
  ) {}

  async collect(
    opts: { rankers?: number; perPlayer?: number; gameTypeId?: string; offset?: number } = {},
  ) {
    if (this.running) return { status: "already_running" };
    this.running = true;
    // Neople 랭킹 API 는 limit 최대 1000 지원 → 상위 N명(offset 시작)까지 수집 가능.
    const rankers = Math.min(Math.max(opts.rankers ?? 20, 1), 1000);
    const perPlayer = Math.min(Math.max(opts.perPlayer ?? 10, 1), 30);
    const offset = Math.max(opts.offset ?? 0, 0);
    const gameTypeId = opts.gameTypeId ?? "rating";
    let scanned = 0;
    let collected = 0;
    let playerRows = 0;

    try {
      const ranking: any = await this.neople.proxy(
        `/ranking/ratingpoint?offset=${offset}&limit=${rankers}`,
      );
      const rows = Array.isArray(ranking?.rows) ? ranking.rows : [];
      const playerIds: string[] = rows
        .map((r: any) => r?.playerId ?? r?.player?.playerId)
        .filter(Boolean);

      for (const pid of playerIds) {
        let matchesResp: any;
        try {
          matchesResp = await this.neople.proxy(
            `/players/${encodeURIComponent(pid)}/matches?gameTypeId=${gameTypeId}&limit=${perPlayer}`,
          );
        } catch {
          continue;
        }
        const mm = matchesResp?.matches;
        const mrows = Array.isArray(mm) ? mm : Array.isArray(mm?.rows) ? mm.rows : [];
        for (const m of mrows) {
          const matchId = m?.matchId;
          if (!matchId) continue;
          scanned++;
          if (await this.matchRepo.existsBy({ matchId })) continue;

          let detail: any;
          try {
            detail = await this.neople.proxy(`/matches/${encodeURIComponent(matchId)}`);
          } catch {
            continue;
          }
          const parsed = parseMatchDetail(matchId, detail);
          if (!parsed) continue;

          await this.dataSource.transaction(async (mgr) => {
            await mgr.getRepository(Match).save(parsed.match);
            if (parsed.players.length) {
              await mgr
                .getRepository(MatchPlayer)
                .insert(parsed.players.map((p) => ({ ...p, matchId })) as unknown as MatchPlayer[]);
            }
          });
          collected++;
          playerRows += parsed.players.length;
        }
      }

      const value = {
        lastRun: new Date().toISOString(),
        rankers,
        offset,
        perPlayer,
        gameTypeId,
        scanned,
        collected,
        playerRows,
      };
      await this.stateRepo.save({ key: "meta_collect", value });
      this.logger.log(`collect done: scanned=${scanned} collected=${collected}`);
      return value;
    } finally {
      this.running = false;
    }
  }

  /**
   * 회전 수집 (Vercel Cron 용). collection_state 에 커서를 저장해두고,
   * 매 호출마다 상위 [offset, offset+window) 구간을 수집한 뒤 커서를 window 만큼 전진.
   * offset 이 maxRank 에 도달하면 0 으로 되돌아간다 (1위부터 다시).
   * 예: window=10, maxRank=500 → 하루 10명씩 → 50일에 한 바퀴 순회.
   */
  async collectRotating(
    opts: { window?: number; perPlayer?: number; gameTypeId?: string; maxRank?: number } = {},
  ) {
    const window = Math.min(Math.max(opts.window ?? 10, 1), 100);
    const maxRank = Math.max(opts.maxRank ?? 500, window);

    const cursorRow = await this.stateRepo.findOne({ where: { key: "meta_cron_cursor" } });
    const offset = Math.max(Number((cursorRow?.value as any)?.offset) || 0, 0);

    const result: any = await this.collect({
      rankers: window,
      perPlayer: opts.perPlayer,
      gameTypeId: opts.gameTypeId,
      offset,
    });

    // 이미 실행 중이면 커서를 전진시키지 않는다.
    if (result?.status === "already_running") return result;

    let next = offset + window;
    if (next >= maxRank) next = 0;
    await this.stateRepo.save({
      key: "meta_cron_cursor",
      value: { offset: next, lastCollectedOffset: offset, window, maxRank },
    });

    return { ...result, mode: "rotating", collectedOffset: offset, nextOffset: next, window, maxRank };
  }
}
