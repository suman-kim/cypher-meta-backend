/**
 * meta.controller.ts
 * ---------------------------------------------------------------------------
 * 사이퍼즈 메타 통계 REST 컨트롤러.
 *
 * 라우트 프리픽스: /meta (전역 프리픽스 포함 시 예: /api/meta).
 * 통계 조회용 엔드포인트(summary/roster/characters/compositions/picks)는 MetaService 에,
 * 데이터 수집 트리거(collect)는 CollectorService 에,
 * 1차/2차 궁극기 정의 조회·판별 관리(ultimates/*)는 UltimateService 에 위임한다.
 * 자동 수집은 Railway 상주 프로세스의 SchedulerService(인메모리 타이머)가 담당한다.
 */
import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { MetaService } from "./meta.service";
import { CollectorService } from "./collector.service";
import { CollectionConfigService, CollectionConfigPatch } from "./collection-config.service";
import { AdminGuard } from "../analytics/admin.guard";
import { UltimateService } from "./ultimate.service";
import { PositionSystemService } from "./position-system";
import { CharacterItemsQuery, UltimateCompositionsQuery } from "./dto";

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
   * @param collectionConfig — 수집 설정(on/off·주기·랭커 수) 서비스.
   * @param ultimates — 1차/2차 궁극기 판별 서비스(궁극기 정의 조회·아이템 재구축·backfill 위임 대상).
   * @param positionSystem — 포지션 체계(official/legacy) 스위치.
   */
  constructor(
    private readonly meta: MetaService,
    private readonly collector: CollectorService,
    private readonly collectionConfig: CollectionConfigService,
    private readonly ultimates: UltimateService,
    private readonly positionSystem: PositionSystemService,
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
   * (캐릭터, 1차/2차 궁극기) 단위 통계 — 공식 역할군 캐릭터 티어용. GET /meta/characters/ultimates.
   * @param gameTypeId — (쿼리) 게임 타입 필터.
   * @returns MetaService.characterUltimateStats() 결과(궁극기 단위 행 배열).
   */
  @Get("characters/ultimates")
  characterUltimates(@Query("gameTypeId") gameTypeId?: string) {
    return this.meta.characterUltimateStats(gameTypeId || undefined);
  }

  /**
   * 현재 포지션 체계(official/legacy)와 공식 역할군 목록. GET /meta/position-system.
   * 프론트는 이 값으로 공식 역할군 화면/기존 포지션 화면을 고른다(롤백 스위치).
   * @returns { system, officialRoles }
   */
  @Get("position-system")
  getPositionSystem() {
    return this.positionSystem.describe();
  }

  /**
   * 특정 캐릭터의 아이템 채용 통계 조회. GET /meta/characters/:id/items?ultimateType=1st|2nd
   * @param id — (경로) 캐릭터 ID.
   * @param q — ultimateType(선택): 1차/2차 궁극기 판만 집계(캐릭터 상세 1차/2차 분리)
   * @returns MetaService.characterItems() 결과(부위별/상위 아이템 채용률).
   */
  @Get("characters/:id/items")
  items(@Param("id") id: string, @Query() q: CharacterItemsQuery) {
    return this.meta.characterItems(id, q.ultimateType);
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
   * 궁극기 단위 듀오/트리오 조합 — 공식 역할군 조합 티어. 예: GET /api/meta/compositions/ultimates?size=2&roles=vanguard,ranger
   * @param q — 조합 인원·역할군 구성 필터·반환 수·최소 표본 (UltimateCompositionsQuery)
   * @returns MetaService.ultimateCompositions() 결과(빈도순/승률순 조합 + 역할군 구성 목록).
   */
  @Get("compositions/ultimates")
  ultimateCompositions(@Query() q: UltimateCompositionsQuery) {
    return this.meta.ultimateCompositions({
      gameTypeId: q.gameTypeId || undefined,
      size: q.size,
      roles: q.roles ? q.roles.split(",").map((x) => x.trim()).filter(Boolean) : undefined,
      limit: q.limit,
      minGames: q.minGames,
    });
  }

  /**
   * 역할 기반 듀오 조합 집계 — 조합 티어 개편. 예: GET /api/meta/compositions/roles?limit=8
   * @param gameTypeId — (쿼리) 게임 타입 필터. 빈 값이면 undefined.
   * @param limit — (쿼리) 카테고리별 반환 조합 수.
   * @param minGames — (쿼리) 승률순 최소 표본 경기 수.
   * @returns MetaService.roleCompositions() 결과(카테고리별 빈도/승률 듀오 목록).
   */
  @Get("compositions/roles")
  roleCompositions(
    @Query("gameTypeId") gameTypeId?: string,
    @Query("limit") limit?: string,
    @Query("minGames") minGames?: string,
  ) {
    return this.meta.roleCompositions({
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
   * 기존 수집분 포지션(role) 소급 백필. POST /meta/roles/backfill (AdminGuard).
   * 방목걸이 착용 행을 무조건 탱커/서포터로 보정하고, 남은 NULL 을 정적 분류로 채운다.
   * 배포 후 1회 실행 권장(여러 번 실행해도 안전 — 멱등).
   */
  @Post("roles/backfill")
  @UseGuards(AdminGuard)
  backfillRoles() {
    return this.collector.backfillRoles();
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
   * 캐릭터별 1차/2차 궁극기 정의(스킬명·공식 역할군·검수 여부) 목록. GET /meta/ultimates.
   * @returns character_ultimates 행 목록(캐릭터명·1st→2nd 순).
   */
  @Get("ultimates")
  listUltimates() {
    return this.ultimates.list();
  }

  /**
   * 판별 기준 아이템 표(ultimate_items) 재구축. POST /meta/ultimates/rebuild-items (AdminGuard).
   * match_players 에 등장한 레어 이상 아이템을 모두 다시 분류한다. 최초 도입·규칙 수정 후 1회 실행.
   * @returns 대상 아이템 수·저장 수.
   */
  @Post("ultimates/rebuild-items")
  @UseGuards(AdminGuard)
  rebuildUltimateItems() {
    return this.ultimates.rebuildItems();
  }

  /**
   * 기존 match_players 의 ultimateType 일괄 채우기. POST /meta/ultimates/backfill (AdminGuard).
   * rebuild-items 이후 실행. 여러 번 실행해도 안전(멱등).
   * @returns 1차 단일·1차·2차·판별 불가 행 수.
   */
  @Post("ultimates/backfill")
  @UseGuards(AdminGuard)
  backfillUltimates() {
    return this.ultimates.backfill();
  }

  /**
   * DB 에서 직접 고친 궁극기 정의·아이템 표를 메모리 캐시에 다시 읽힌다. POST /meta/ultimates/reload (AdminGuard).
   * @returns 적재된 캐릭터 수·아이템 수.
   */
  @Post("ultimates/reload")
  @UseGuards(AdminGuard)
  reloadUltimates() {
    return this.ultimates.loadRules();
  }
}
