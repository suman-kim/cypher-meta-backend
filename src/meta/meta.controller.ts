import { Controller, Get, Param, Post, Query } from "@nestjs/common";
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
}
