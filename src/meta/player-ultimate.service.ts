/**
 * player-ultimate.service.ts
 * ---------------------------------------------------------------------------
 * 개인 히스토리(player_matches)의 1차/2차 궁극기 판별 — 백그라운드 처리.
 *
 * player_matches 는 매치 "목록" API 로 쌓아서 장착 아이템이 없다. 그래서 행마다 아래 순서로 채운다.
 *  1) 1차만 있는 캐릭터 → "1st" (API 호출 없음, SQL 일괄)
 *  2) 같은 경기가 메타 수집(match_players)에 이미 있으면 그 판별값을 복사 (API 호출 없음)
 *  3) 나머지는 매치 상세(/matches/{id})를 조회해 그 플레이어의 장착 아이템으로 판별
 * 처리한 행은 ultimateCheckedAt 을 찍어 다시 처리하지 않는다(판별 불가여도 null 로 확정).
 * 조회 실패(네트워크·5xx)는 찍지 않아 다음 실행에서 다시 시도된다.
 *
 * ⚠ Neople 매치 상세는 현재 시즌 경기만 남는다(2026-09 확인: 약 45일 전까지 200, 두 달 전은 404 CY003).
 *   지난 시즌 경기는 404 → 판별 불가(null)로 확정된다. 그래서 적립 직후 바로 처리하는 것이 중요하다
 *   (syncOnView·refreshWatchlist 끝에서 자동 실행).
 *
 * 진입점
 *  - resolveForPlayer(): 프로필 조회 훅에서 fire-and-forget 으로 호출(그 플레이어만)
 *  - resolvePending():   관리자 배치 — 전체 미처리 행을 물량 상한만큼 처리(기존 데이터 백필)
 */
import { Injectable, Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import { NeopleService } from "../neople/neople.service";
import { UltimateService } from "./ultimate.service";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 매치 상세 동시 조회 수 — Neople 한도(초당 1,000회) 대비 보수적으로 */
const DETAIL_CONCURRENCY = 5;

/** 한 번 실행의 처리 결과 요약 */
export interface PlayerUltimateRunResult {
  /** 1차만 있는 캐릭터로 1st 확정한 행 수 */
  single: number;
  /** match_players 에서 복사한 행 수 */
  copied: number;
  /** 매치 상세를 조회해 처리한 행 수(판별 불가 포함) */
  fetched: number;
  /** 매치 상세 조회 실패로 다음에 다시 시도할 행 수 */
  failed: number;
  /** 실행 후 남은 미처리 행 수(대상 범위 기준) */
  remaining: number;
}

/** 개인 히스토리 궁극기 판별 서비스 */
@Injectable()
export class PlayerUltimateService {
  private readonly logger = new Logger(PlayerUltimateService.name);
  /** 같은 플레이어를 동시에 두 번 처리하지 않도록 진행 중인 playerId 목록 */
  private readonly inFlight = new Set<string>();
  /** 전체 배치 동시 실행 방지 */
  private batchRunning = false;

  /**
   * @param dataSource — player_matches 원시 SQL 갱신용
   * @param neople — 매치 상세 조회용 Neople 프록시
   * @param ultimates — 판별 규칙(1차/2차 캐릭터 여부·아이템 판별)
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly neople: NeopleService,
    private readonly ultimates: UltimateService,
  ) {}

  /**
   * 한 플레이어의 미처리 행을 판별한다(프로필 조회 훅용, 이미 진행 중이면 건너뜀).
   * @param playerId — 대상 플레이어 ID
   * @param maxFetch — 이번 실행에서 매치 상세를 조회할 최대 경기 수(기본 300)
   * @returns 처리 요약(진행 중이라 건너뛰면 null)
   */
  async resolveForPlayer(playerId: string, maxFetch = 300): Promise<PlayerUltimateRunResult | null> {
    if (this.inFlight.has(playerId)) return null;
    this.inFlight.add(playerId);
    try {
      return await this.run({ playerId, maxFetch });
    } finally {
      this.inFlight.delete(playerId);
    }
  }

  /**
   * 전체 미처리 행을 물량 상한만큼 판별한다(관리자 배치 — 기존 데이터 백필).
   * 여러 번 나눠 실행하면 이어서 처리된다(remaining 이 0 이 될 때까지).
   * @param maxFetch — 이번 실행에서 매치 상세를 조회할 최대 경기 수(기본 2,000)
   * @returns 처리 요약(이미 실행 중이면 null)
   */
  async resolvePending(maxFetch = 2000): Promise<PlayerUltimateRunResult | null> {
    if (this.batchRunning) return null;
    this.batchRunning = true;
    try {
      return await this.run({ maxFetch });
    } finally {
      this.batchRunning = false;
    }
  }

  /**
   * 공통 처리 — 1) 1차 단일 일괄 → 2) match_players 복사 → 3) 매치 상세 조회 순.
   * @param scope.playerId — 지정 시 그 플레이어만, 없으면 전체
   * @param scope.maxFetch — 매치 상세 조회 상한(경기 수)
   * @returns 처리 요약
   */
  private async run(scope: { playerId?: string; maxFetch: number }): Promise<PlayerUltimateRunResult> {
    await this.ultimates.ensureReady();
    const params: any[] = [];
    let playerCond = "";
    if (scope.playerId) {
      params.push(scope.playerId);
      playerCond = `AND pm."playerId" = $1`;
    }

    // 1) 2차 궁극기가 없는 캐릭터 → 1st 확정
    const single = await this.dataSource.query(
      `UPDATE player_matches pm SET "ultimateType" = '1st', "ultimateCheckedAt" = now()
        WHERE pm."ultimateCheckedAt" IS NULL ${playerCond}
          AND pm."characterId" IN (
            SELECT "characterId" FROM character_ultimates GROUP BY "characterId" HAVING count(*) = 1)`,
      params,
    );

    // 2) 메타 수집에 같은 경기·같은 플레이어가 판별돼 있으면 복사
    const copied = await this.dataSource.query(
      `UPDATE player_matches pm SET "ultimateType" = mp."ultimateType", "ultimateCheckedAt" = now()
         FROM match_players mp
        WHERE pm."ultimateCheckedAt" IS NULL ${playerCond}
          AND mp."matchId" = pm."matchId" AND mp."playerId" = pm."playerId"
          AND mp."ultimateType" IS NOT NULL`,
      params,
    );

    // 3) 남은 행(1차/2차 보유 캐릭터) → 매치 상세 조회
    const pending: { playerId: string; matchId: string }[] = await this.dataSource.query(
      `SELECT pm."playerId", pm."matchId" FROM player_matches pm
        WHERE pm."ultimateCheckedAt" IS NULL ${playerCond}
        ORDER BY pm."playedAt" DESC NULLS LAST
        LIMIT ${Math.max(0, Math.floor(scope.maxFetch))}`,
      params,
    );
    let fetched = 0;
    let failed = 0;
    for (let i = 0; i < pending.length; i += DETAIL_CONCURRENCY) {
      const chunk = pending.slice(i, i + DETAIL_CONCURRENCY);
      const results = await Promise.all(chunk.map((r) => this.resolveOne(r.playerId, r.matchId)));
      for (const ok of results) ok ? fetched++ : failed++;
    }

    const rem: any[] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM player_matches pm WHERE pm."ultimateCheckedAt" IS NULL ${playerCond}`,
      params,
    );
    const result: PlayerUltimateRunResult = {
      single: this.affected(single),
      copied: this.affected(copied),
      fetched,
      failed,
      remaining: rem[0]?.n ?? 0,
    };
    this.logger.log(`개인 히스토리 궁극기 판별${scope.playerId ? ` (${scope.playerId})` : ""}: ${JSON.stringify(result)}`);
    return result;
  }

  /**
   * 경기 1건의 매치 상세를 조회해 해당 플레이어의 궁극기를 판별·저장한다.
   * @param playerId — 대상 플레이어 ID
   * @param matchId — 경기 ID
   * @returns true=처리 완료(판별 불가 포함), false=조회 실패(다음에 재시도)
   */
  private async resolveOne(playerId: string, matchId: string): Promise<boolean> {
    let detail: any;
    try {
      // store:false — 대량 백필로 api_cache 가 불어나지 않게 캐시에 새로 저장하지 않는다(있으면 읽기는 함)
      detail = await this.neople.proxy(`/matches/${encodeURIComponent(matchId)}`, { store: false });
    } catch (e) {
      const status = (e as any)?.status ?? (e as any)?.getStatus?.();
      // 4xx(없는 경기 등)는 다시 시도해도 같으므로 판별 불가로 확정, 그 외는 재시도
      if (typeof status === "number" && status >= 400 && status < 500) {
        await this.save(playerId, matchId, null);
        return true;
      }
      return false;
    }
    const players: any[] = Array.isArray(detail?.players) ? detail.players : [];
    const me = players.find((p) => String(p?.playerId) === playerId);
    const characterId = String(me?.playInfo?.characterId ?? "");
    const items = Array.isArray(me?.items) ? me.items : [];
    let ult: string | null = null;
    if (me && characterId) {
      await this.ultimates.prepareItems([{ characterId, items }]);
      ult = this.ultimates.resolve(characterId, items);
    }
    await this.save(playerId, matchId, ult);
    return true;
  }

  /**
   * 판별 결과를 저장하고 처리 시각을 찍는다.
   * @param playerId — 플레이어 ID
   * @param matchId — 경기 ID
   * @param ultimateType — "1st"/"2nd"/null(판별 불가)
   */
  private async save(playerId: string, matchId: string, ultimateType: string | null): Promise<void> {
    await this.dataSource.query(
      `UPDATE player_matches SET "ultimateType" = $3, "ultimateCheckedAt" = now()
        WHERE "playerId" = $1 AND "matchId" = $2`,
      [playerId, matchId, ultimateType],
    );
  }

  /**
   * pg 드라이버 UPDATE 결과에서 영향 행 수를 꺼낸다([rows, count] 형태).
   * @param res — dataSource.query 의 UPDATE 반환값
   * @returns 영향 행 수(알 수 없으면 0)
   */
  private affected(res: any): number {
    return Array.isArray(res) && typeof res[1] === "number" ? res[1] : 0;
  }
}
