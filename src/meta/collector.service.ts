/**
 * 메타 통계용 매치 데이터 수집 서비스.
 *
 * Neople 사이퍼즈 오픈 API 를 호출해 상위 랭커들의 매치를 긁어와
 * matches / match_players 테이블에 적재한다. 전체 흐름:
 *   1) 평점(레이팅) 랭킹 API 로 상위 랭커 playerId 목록을 가져오고,
 *   2) 각 플레이어의 최근 매치 목록을 조회한 뒤,
 *   3) 아직 저장하지 않은 매치의 상세를 받아 parseMatchDetail 로 파싱해 DB 트랜잭션으로 저장한다.
 *
 * 두 가지 진입점을 제공한다.
 *   - collect(): 상위 N명을 한 번에 수집 (고정 모드 / 수동·스케줄러용).
 *   - collectRotating(): collection_config 커서로 구간을 나눠 순회 수집 (회전 모드 / Cron 용).
 *
 * running 플래그로 동시 실행을 막고, 매 실행을 collection_run 이력 테이블에 기록한다
 * (트리거 자동/수동, 커버한 랭커 범위, 결과 카운트, 성공/실패 상태).
 */
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { Match, MatchPlayer, CollectionState, CollectionRun } from "../database/entities";
import { NeopleService } from "../neople/neople.service";
import { CollectionConfigService } from "./collection-config.service";
import { parseMatchDetail } from "./match-parser";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 이번 수집 실행의 트리거 메타(이력 기록용). */
export interface RunMeta {
  /** auto(자동: 스케줄러/크론) | manual(수동: 관리자 API). */
  trigger: "auto" | "manual";
  /** interval(주기 스케줄러) | cron(Vercel Cron) | api(수동 API) | boot(부팅 최초). */
  source: "interval" | "cron" | "api" | "boot";
}

const clamp = (v: number | undefined, min: number, max: number, d: number): number =>
  Math.min(Math.max(Math.floor(Number(v ?? d)) || d, min), max);

/**
 * 랭킹 → 매치 목록 → 매치 상세 순으로 Neople API 를 호출해
 * 메타 통계용 매치 데이터를 DB 에 적재하는 수집 서비스.
 */
@Injectable()
export class CollectorService {
  private readonly logger = new Logger(CollectorService.name);
  private running = false;

  /**
   * 의존성 주입.
   * @param neople — Neople 오픈 API 프록시 호출용 서비스.
   * @param matchRepo — matches 테이블(Match) 리포지토리 (중복 확인·저장용).
   * @param mpRepo — match_players 테이블(MatchPlayer) 리포지토리.
   * @param stateRepo — 수집 상태 요약을 저장하는 collection_state 리포지토리(하위호환용).
   * @param runRepo — 수집 실행 이력을 남기는 collection_run 리포지토리.
   * @param config — 수집 설정(DB) 서비스 — 회전 커서 읽기/전진에 사용.
   * @param dataSource — 매치+플레이어 원자적 저장을 위한 트랜잭션 실행용 TypeORM DataSource.
   */
  constructor(
    private readonly neople: NeopleService,
    @InjectRepository(Match) private readonly matchRepo: Repository<Match>,
    @InjectRepository(MatchPlayer) private readonly mpRepo: Repository<MatchPlayer>,
    @InjectRepository(CollectionState) private readonly stateRepo: Repository<CollectionState>,
    @InjectRepository(CollectionRun) private readonly runRepo: Repository<CollectionRun>,
    private readonly config: CollectionConfigService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 상위 랭커들의 매치를 조회해 신규 매치만 DB 에 저장한다.
   *
   * 랭킹 API 로 상위 랭커 playerId 를 얻고, 각 플레이어의 최근 매치 목록을 순회하며
   * 아직 저장되지 않은 매치의 상세를 받아 파싱·저장한다. 이미 running 이면 곧바로 반환한다.
   * 실행 시작 시 collection_run 에 running 이력을 만들고, 완료/실패 시 이를 갱신한다.
   *
   * @param opts — 수집 옵션(rankers/perPlayer/gameTypeId/offset/mode).
   * @param meta — 실행 트리거 메타(자동/수동, 출처) — 이력 기록에 사용.
   * @returns 이미 실행 중이면 { status: "already_running" }, 아니면 수집 결과 요약
   *          (runId·rankFrom·rankTo·scanned·collected·playerRows 등).
   */
  async collect(
    opts: {
      /** 수집 대상 상위 랭커 수 = ratingpoint 랭킹 조회의 limit. offset 부터 N명. 기본 20, 1~1000 클램프. */
      rankers?: number;
      /** 각 랭커의 최근 매치 조회 수 = players/{id}/matches limit. 기본 10, 1~30 클램프. */
      perPlayer?: number;
      /** 게임 타입. "rating"=공식전. 기본 "rating". */
      gameTypeId?: string;
      /** 랭킹 시작 오프셋(0=1위). 회전 수집이 구간 이동에 사용. 기본 0. */
      offset?: number;
      /** 이력에 남길 수집 방식(rotating|fixed). 기본 fixed. */
      mode?: "rotating" | "fixed";
    } = {},
    meta: RunMeta = { trigger: "manual", source: "api" },
  ) {
    if (this.running) return { status: "already_running" };
    this.running = true;
    // Neople 랭킹 API 는 limit 최대 1000 지원 → 상위 N명(offset 시작)까지 수집 가능.
    const rankers = clamp(opts.rankers, 1, 1000, 20);
    const perPlayer = clamp(opts.perPlayer, 1, 30, 10);
    const offset = Math.max(Math.floor(opts.offset ?? 0) || 0, 0);
    const gameTypeId = opts.gameTypeId ?? "rating";
    const mode = opts.mode ?? "fixed";
    const startedMs = Date.now();

    // 실행 이력 행 생성(running). 커버 범위는 offset+1 ~ offset+rankers(1-based).
    const run = await this.runRepo.save(
      this.runRepo.create({
        trigger: meta.trigger,
        source: meta.source,
        mode,
        gameType: gameTypeId,
        rankFrom: offset + 1,
        rankTo: offset + rankers,
        offset,
        windowSize: rankers,
        perPlayer,
        status: "running",
        error: null,
        finishedAt: null,
        durationMs: null,
      }),
    );

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

      // 하위호환: 마지막 실행 요약을 collection_state 에도 남긴다(기존 summary 폴백용).
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

      // 실행 이력 완료 기록.
      await this.runRepo.update(run.id, {
        scanned,
        collected,
        playerRows,
        status: "success",
        finishedAt: new Date(),
        durationMs: Date.now() - startedMs,
      });

      this.logger.log(
        `collect done: ${meta.trigger}/${meta.source} rank ${offset + 1}~${offset + rankers} scanned=${scanned} collected=${collected}`,
      );
      return {
        ...value,
        runId: run.id,
        trigger: meta.trigger,
        source: meta.source,
        mode,
        rankFrom: offset + 1,
        rankTo: offset + rankers,
      };
    } catch (e) {
      // 실패 이력 기록 후 예외 전파.
      await this.runRepo
        .update(run.id, {
          scanned,
          collected,
          playerRows,
          status: "failed",
          error: ((e as Error)?.message ?? "unknown").slice(0, 500),
          finishedAt: new Date(),
          durationMs: Date.now() - startedMs,
        })
        .catch(() => undefined);
      this.logger.error(`collect failed: ${(e as Error)?.message}`);
      throw e;
    } finally {
      this.running = false;
    }
  }

  /**
   * 회전 수집 (Cron/스케줄러 회전 모드). collection_config.cursorOffset 를 이용해
   * 매 호출마다 상위 [offset, offset+window) 구간을 수집한 뒤 커서를 window 만큼 전진한다.
   * offset 이 maxRank 에 도달하면 0 으로 되돌아간다 (1위부터 다시).
   * 예: window=10, maxRank=500 → 하루 10명씩 → 50일에 한 바퀴 순회.
   *
   * @param opts — 회전 수집 옵션(window/perPlayer/gameTypeId/maxRank).
   * @param meta — 실행 트리거 메타(기본 auto/cron).
   * @returns collect 결과에 회전 메타(mode·collectedOffset·nextOffset·window·maxRank)를 덧붙인 객체.
   */
  /**
   * 최근 수집 실행 이력을 최신순으로 조회한다(관리자 UI 용).
   * @param limit — 반환 개수(기본 30, 1~200 클램프).
   */
  async listRuns(limit = 30) {
    const take = Math.min(Math.max(Math.floor(limit) || 30, 1), 200);
    return this.runRepo.find({ order: { id: "DESC" }, take });
  }

  async collectRotating(
    opts: { window?: number; perPlayer?: number; gameTypeId?: string; maxRank?: number } = {},
    meta: RunMeta = { trigger: "auto", source: "cron" },
  ) {
    const window = clamp(opts.window, 1, 100, 10);
    const maxRank = Math.max(clamp(opts.maxRank, 1, 100000, 500), window);

    // 커서는 DB(config)에서 읽는다. 상한이 줄어든 경우를 대비해 maxRank 로 나눈 나머지로 보정.
    const cfg = await this.config.getConfig();
    const offset = (Math.max(cfg.cursorOffset || 0, 0)) % maxRank;

    const result: any = await this.collect(
      { rankers: window, perPlayer: opts.perPlayer, gameTypeId: opts.gameTypeId, offset, mode: "rotating" },
      meta,
    );

    // 이미 실행 중이면 커서를 전진시키지 않는다.
    if (result?.status === "already_running") return result;

    let next = offset + window;
    if (next >= maxRank) next = 0;
    await this.config.setCursor(next);

    return { ...result, mode: "rotating", collectedOffset: offset, nextOffset: next, window, maxRank };
  }
}
