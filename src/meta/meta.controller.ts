import { Controller, Get, Headers, Param, Post, Query, UnauthorizedException } from "@nestjs/common";
import { MetaService } from "./meta.service";
import { CollectorService } from "./collector.service";

@Controller("meta")
export class MetaController {
  constructor(
    private readonly meta: MetaService,
    private readonly collector: CollectorService,
  ) {}

  @Get("summary")
  summary() {
    return this.meta.summary();
  }

  @Get("roster")
  roster() {
    return this.meta.roster();
  }

  @Get("characters")
  characters(@Query("gameTypeId") gameTypeId?: string) {
    return this.meta.characterStats(gameTypeId);
  }

  @Get("characters/:id/items")
  items(@Param("id") id: string) {
    return this.meta.characterItems(id);
  }

  /** 5인(풀팀) 조합 집계 — 빈도/승률. 예: GET /api/meta/compositions?limit=6&minGames=3 */
  @Get("compositions")
  compositions(
    @Query("gameTypeId") gameTypeId?: string,
    @Query("limit") limit?: string,
    @Query("minGames") minGames?: string,
  ) {
    return this.meta.compositions({
      gameTypeId: gameTypeId || undefined,
      limit: limit ? Number(limit) : undefined,
      minGames: minGames ? Number(minGames) : undefined,
    });
  }

  /** 수집 트리거 (수동). 예: POST /api/meta/collect?rankers=20&perPlayer=10 */
  @Post("collect")
  collect(
    @Query("rankers") rankers?: string,
    @Query("perPlayer") perPlayer?: string,
    @Query("gameTypeId") gameTypeId?: string,
    @Query("offset") offset?: string,
  ) {
    return this.collector.collect({
      rankers: rankers ? Number(rankers) : undefined,
      perPlayer: perPlayer ? Number(perPlayer) : undefined,
      gameTypeId,
      offset: offset ? Number(offset) : undefined,
    });
  }

  /**
   * Vercel Cron 전용 회전 수집 트리거 (GET). vercel.json crons 에서 호출.
   * CRON_SECRET 이 설정되면 Vercel이 보내는 `Authorization: Bearer <secret>` 를 검증.
   * 매 호출마다 상위 window명씩 구간을 이동하며 수집(커서는 DB에 저장), maxRank 도달 시 1위부터 다시.
   */
  @Get("cron/collect")
  cronCollect(@Headers("authorization") auth?: string) {
    const secret = process.env.CRON_SECRET;
    if (secret && auth !== `Bearer ${secret}`) {
      throw new UnauthorizedException("invalid cron secret");
    }
    return this.collector.collectRotating({
      window: Number(process.env.META_CRON_WINDOW) || 10,
      perPlayer: Number(process.env.META_COLLECT_PER_PLAYER) || 10,
      gameTypeId: process.env.META_COLLECT_GAME_TYPE ?? "rating",
      maxRank: Number(process.env.META_CRON_MAX_RANK) || 500,
    });
  }
}
