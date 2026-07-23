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

  @Get("characters")
  characters(@Query("gameTypeId") gameTypeId?: string) {
    return this.meta.characterStats(gameTypeId);
  }

  @Get("characters/:id/items")
  items(@Param("id") id: string) {
    return this.meta.characterItems(id);
  }

  /** 수집 트리거 (수동). 예: POST /api/meta/collect?rankers=20&perPlayer=10 */
  @Post("collect")
  collect(
    @Query("rankers") rankers?: string,
    @Query("perPlayer") perPlayer?: string,
    @Query("gameTypeId") gameTypeId?: string,
  ) {
    return this.collector.collect({
      rankers: rankers ? Number(rankers) : undefined,
      perPlayer: perPlayer ? Number(perPlayer) : undefined,
      gameTypeId,
    });
  }

  /**
   * Vercel Cron 전용 수집 트리거 (GET). vercel.json crons 에서 호출.
   * CRON_SECRET 이 설정되면 Vercel이 보내는 `Authorization: Bearer <secret>` 를 검증.
   * 서버리스 타임아웃 고려해 기본 표본을 작게(8/8) 잡고, .env 로 조절.
   */
  @Get("cron/collect")
  cronCollect(@Headers("authorization") auth?: string) {
    const secret = process.env.CRON_SECRET;
    if (secret && auth !== `Bearer ${secret}`) {
      throw new UnauthorizedException("invalid cron secret");
    }
    return this.collector.collect({
      rankers: Number(process.env.META_COLLECT_RANKERS) || 8,
      perPlayer: Number(process.env.META_COLLECT_PER_PLAYER) || 8,
      gameTypeId: process.env.META_COLLECT_GAME_TYPE ?? "rating",
    });
  }
}
