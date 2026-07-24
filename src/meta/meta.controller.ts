/**
 * meta.controller.ts
 * ---------------------------------------------------------------------------
 * 사이퍼즈 메타 통계 REST 컨트롤러.
 *
 * 라우트 프리픽스: /meta (전역 프리픽스 포함 시 예: /api/meta).
 * 통계 조회용 엔드포인트(summary/roster/characters/compositions/picks)는 MetaService 에,
 * 데이터 수집 트리거(collect/cron/collect)는 CollectorService 에 위임한다.
 * cron/collect 는 Vercel Cron 전용이며 CRON_SECRET 으로 보호된다.
 */
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { MetaService } from "./meta.service";
import { CollectorService } from "./collector.service";
import { CollectionConfigService, CollectionConfigPatch } from "./collection-config.service";
import { AdminGuard } from "../analytics/admin.guard";

/**
 * 메타 통계 및 수집 트리거를 노출하는 컨트롤러.
 * HTTP 요청 파라미터를 파싱해 서비스 계층으로 전달하는 얇은 어댑터 역할을 한다.
 */
@Controller("meta")
export class MetaController {
  /**
   * 의존성 주입 생성자.
   * @param meta — 메타 통계 계산 서비스(조회성 엔드포인트 위임 대상).
   * @param collector — 매치/플레이어 데이터 수집 서비스(수집 트리거 위임 대상).
   */
  constructor(
    private readonly meta: MetaService,
    private readonly collector: CollectorService,
    private readonly collectionConfig: CollectionConfigService,
  ) {}

  /**
   * 수집 현황 요약 조회. GET /meta/summary.
   * @returns MetaService.summary() 결과(매치/레코드/캐릭터 수 및 집계 범위).
   */
  @Get("summary")
  summary() {
    return this.meta.summary();
  }

  /**
   * 전체 캐릭터 로스터(역할 포함) 조회. GET /meta/roster.
   * @returns MetaService.roster() 결과(캐릭터 목록).
   */
  @Get("roster")
  roster() {
    return this.meta.roster();
  }

  /**
   * 캐릭터별 픽/승률/KDA 통계 조회. GET /meta/characters.
   * @param gameTypeId — (쿼리) 게임 타입 필터. 미지정 시 전체 집계.
   * @returns MetaService.characterStats() 결과(캐릭터별 통계 배열).
   */
  @Get("characters")
  characters(@Query("gameTypeId") gameTypeId?: string) {
    return this.meta.characterStats(gameTypeId);
  }

  /**
   * 특정 캐릭터의 아이템 채용 통계 조회. GET /meta/characters/:id/items.
   * @param id — (경로) 캐릭터 ID.
   * @returns MetaService.characterItems() 결과(부위별/상위 아이템 채용률).
   */
  @Get("characters/:id/items")
  items(@Param("id") id: string) {
    return this.meta.characterItems(id);
  }

  /**
   * 특정 캐릭터를 픽한 표본 기록(누가·어떤 경기). GET /meta/characters/:id/picks.
   * @param id — (경로) 캐릭터 ID.
   * @param gameTypeId — (쿼리) 게임 타입 필터. 빈 값이면 undefined 로 전달.
   * @param limit — (쿼리) 반환 표본 개수 문자열. 숫자로 변환해 전달, 없으면 undefined.
   * @returns MetaService.characterPicks() 결과(픽 표본 목록).
   */
  @Get("characters/:id/picks")
  picks(
    @Param("id") id: string,
    @Query("gameTypeId") gameTypeId?: string,
    @Query("limit") limit?: string,
  ) {
    return this.meta.characterPicks(id, gameTypeId || undefined, limit ? Number(limit) : undefined);
  }

  /**
   * 5인(풀팀) 조합 집계 — 빈도/승률. 예: GET /api/meta/compositions?limit=6&minGames=3
   * @param gameTypeId — (쿼리) 게임 타입 필터. 빈 값이면 undefined 로 전달.
   * @param limit — (쿼리) 반환 조합 수 문자열. 숫자로 변환, 없으면 undefined.
   * @param minGames — (쿼리) 승률 산정 최소 경기 수 문자열. 숫자로 변환, 없으면 undefined.
   * @returns MetaService.compositions() 결과(빈도순/승률순 조합 목록).
   */
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

  /**
   * 특정 조합이 등장한 표본 매치 목록 + 멤버. 예: GET /api/meta/compositions/matches?ids=a,b,c,d,e
   * @param ids — (쿼리) 쉼표로 구분된 캐릭터 ID 목록. 없으면 빈 문자열로 전달.
   * @param gameTypeId — (쿼리) 게임 타입 필터. 빈 값이면 undefined 로 전달.
   * @param limit — (쿼리) 반환 매치 개수 문자열. 숫자로 변환, 없으면 undefined.
   * @returns MetaService.compositionMatches() 결과(매치별 멤버 포함 목록).
   */
  @Get("compositions/matches")
  compMatches(
    @Query("ids") ids?: string,
    @Query("gameTypeId") gameTypeId?: string,
    @Query("limit") limit?: string,
  ) {
    return this.meta.compositionMatches(ids ?? "", gameTypeId || undefined, limit ? Number(limit) : undefined);
  }

  /**
   * 수집 트리거 (수동). 예: POST /api/meta/collect?rankers=20&perPlayer=10
   * @param rankers — (쿼리) 수집 대상 상위 랭커 수 문자열. 숫자로 변환, 없으면 undefined.
   * @param perPlayer — (쿼리) 플레이어당 수집할 매치 수 문자열. 숫자로 변환, 없으면 undefined.
   * @param gameTypeId — (쿼리) 게임 타입. 문자열 그대로 전달.
   * @param offset — (쿼리) 시작 오프셋(순위) 문자열. 숫자로 변환, 없으면 undefined.
   * @returns CollectorService.collect() 결과(수집 작업 결과).
   */
  @Post("collect")
  @UseGuards(AdminGuard)
  collect(
    @Query("rankers") rankers?: string,
    @Query("perPlayer") perPlayer?: string,
    @Query("gameTypeId") gameTypeId?: string,
    @Query("offset") offset?: string,
  ) {
    return this.collector.collect(
      {
        rankers: rankers ? Number(rankers) : undefined,
        perPlayer: perPlayer ? Number(perPlayer) : undefined,
        gameTypeId,
        offset: offset ? Number(offset) : undefined,
        mode: "fixed",
      },
      { trigger: "manual", source: "api" },
    );
  }

  /**
   * 수집 설정 조회. GET /meta/collect/config (AdminGuard).
   * @returns 현재 collection_config 설정.
   */
  @Get("collect/config")
  @UseGuards(AdminGuard)
  getCollectConfig() {
    return this.collectionConfig.getConfig();
  }

  /**
   * 수집 설정 수정. POST /meta/collect/config (AdminGuard). 본문 = 부분 설정.
   * @returns 변경된 설정.
   */
  @Post("collect/config")
  @UseGuards(AdminGuard)
  updateCollectConfig(@Body() body: CollectionConfigPatch) {
    return this.collectionConfig.updateConfig(body ?? {});
  }

  /**
   * 수집 실행 이력 조회. GET /meta/collect/runs?limit=30 (AdminGuard).
   * @param limit — 반환 개수(기본 30).
   * @returns 최신순 수집 실행 이력 배열.
   */
  @Get("collect/runs")
  @UseGuards(AdminGuard)
  collectRuns(@Query("limit") limit?: string) {
    return this.collector.listRuns(limit ? Number(limit) : undefined);
  }

  /**
   * 수동 "지금 수집" — 현재 설정(mode)에 맞춰 즉시 1회 수집. POST /meta/collect/run-now (AdminGuard).
   * 트리거는 manual/api 로 기록된다.
   * @returns 수집 결과 요약.
   */
  @Post("collect/run-now")
  @UseGuards(AdminGuard)
  async runNow() {
    const cfg = await this.collectionConfig.getConfig();
    if (cfg.mode === "rotating") {
      return this.collector.collectRotating(
        { window: cfg.cronWindow, perPlayer: cfg.perPlayer, gameTypeId: cfg.gameType, maxRank: cfg.maxRank },
        { trigger: "manual", source: "api" },
      );
    }
    return this.collector.collect(
      { rankers: cfg.rankers, perPlayer: cfg.perPlayer, gameTypeId: cfg.gameType, offset: 0, mode: "fixed" },
      { trigger: "manual", source: "api" },
    );
  }

  /**
   * Vercel Cron 전용 회전 수집 트리거 (GET). vercel.json crons 에서 호출.
   * CRON_SECRET 이 설정되면 Vercel이 보내는 `Authorization: Bearer <secret>` 를 검증.
   * 매 호출마다 상위 window명씩 구간을 이동하며 수집(커서는 DB에 저장), maxRank 도달 시 1위부터 다시.
   *
   * @param auth — (헤더) Authorization 값. CRON_SECRET 설정 시 `Bearer <secret>` 와 일치해야 함.
   * @returns CollectorService.collectRotating() 결과(회전 수집 작업 결과).
   * @throws UnauthorizedException — CRON_SECRET 이 설정되어 있으나 인증 헤더가 일치하지 않을 때.
   */
  @Get("cron/collect")
  async cronCollect(@Headers("authorization") auth?: string) {
    const secret = process.env.CRON_SECRET;
    if (secret && auth !== `Bearer ${secret}`) {
      throw new UnauthorizedException("invalid cron secret");
    }
    // 수집 파라미터는 env 가 아니라 DB(collection_config)에서 읽는다.
    const cfg = await this.collectionConfig.getConfig();
    if (!cfg.autoCollect) {
      return { status: "disabled", reason: "autoCollect=false (collection_config)" };
    }
    if (cfg.mode === "rotating") {
      return this.collector.collectRotating(
        { window: cfg.cronWindow, perPlayer: cfg.perPlayer, gameTypeId: cfg.gameType, maxRank: cfg.maxRank },
        { trigger: "auto", source: "cron" },
      );
    }
    return this.collector.collect(
      { rankers: cfg.rankers, perPlayer: cfg.perPlayer, gameTypeId: cfg.gameType, offset: 0, mode: "fixed" },
      { trigger: "auto", source: "cron" },
    );
  }
}
