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

  async collect(opts: { rankers?: number; perPlayer?: number; gameTypeId?: string } = {}) {
    if (this.running) return { status: "already_running" };
    this.running = true;
    const rankers = Math.min(Math.max(opts.rankers ?? 20, 1), 100);
    const perPlayer = Math.min(Math.max(opts.perPlayer ?? 10, 1), 30);
    const gameTypeId = opts.gameTypeId ?? "rating";
    let scanned = 0;
    let collected = 0;
    let playerRows = 0;

    try {
      const ranking: any = await this.neople.proxy(`/ranking/ratingpoint?limit=${rankers}`);
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
}
