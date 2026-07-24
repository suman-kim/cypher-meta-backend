/**
 * votes.service.ts
 * ------------------------------------------------------------------
 * 사용자 투표(캐릭터 티어 / 조합 티어) 비즈니스 로직.
 * Vote 엔티티(리포지토리)를 사용해 방문자(visitorId)별 투표를 저장/갱신(upsert)하고,
 * 전체 투표를 집계해 역할별 상위 캐릭터 및 인기 조합을 산출한다.
 *  - tier: 역할(tank/melee/ranged/support)별 캐릭터 1명 선택.
 *  - comp: 편성(FORMATION_MAP) 규칙에 맞춘 캐릭터 조합.
 * 투표는 로그인 없이 visitorId + kind 조합으로 1개만 유지된다(재투표 시 덮어씀).
 * ------------------------------------------------------------------
 */
import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Vote } from "../database/entities";
import { FORMATION_MAP, type Role } from "../meta/formations";

/* eslint-disable @typescript-eslint/no-explicit-any */

// 티어 투표에서 다루는 역할 목록(탱커/근접딜러/원거리딜러/서포터).
// 집계 및 picks 검증의 기준이 된다.
const ROLES: Role[] = ["tank", "melee", "ranged", "support"];

/**
 * 투표 서비스.
 * 방문자별 티어/조합 투표의 저장(upsert)과 집계를 담당한다.
 */
@Injectable()
export class VotesService {
  /**
   * @param repo — 투표(Vote) TypeORM 리포지토리 (DI 주입)
   */
  constructor(@InjectRepository(Vote) private readonly repo: Repository<Vote>) {}

  /**
   * 방문자+종류(kind) 기준으로 투표를 저장하거나(신규) 기존 투표의 payload 를 갱신한다.
   * @param visitorId — 방문자 식별자(없으면 400 예외)
   * @param kind — 투표 종류("tier" 또는 "comp")
   * @param payload — 저장할 투표 내용(JSON)
   * @returns 저장된 Vote 엔티티
   */
  private async upsert(visitorId: string, kind: string, payload: any) {
    if (!visitorId) throw new BadRequestException("visitorId required");
    const existing = await this.repo.findOne({ where: { visitorId, kind } });
    if (existing) {
      existing.payload = payload;
      return this.repo.save(existing);
    }
    return this.repo.save(this.repo.create({ visitorId, kind, payload }));
  }

  /* ---- 캐릭터 티어 투표 (역할별 최고 캐릭터 1명) ---- */

  /**
   * 캐릭터 티어 투표를 저장한다. 입력 picks 에서 유효한(문자열, 빈 값 아님) 역할별 선택만 추린다.
   * @param visitorId — 방문자 식별자
   * @param picksIn — 역할 → 캐릭터 id 맵(임의 입력). 유효 선택이 0개면 400 예외
   * @returns 저장 결과({ ok: true, picks })
   */
  async saveTier(visitorId: string, picksIn: any) {
    const picks: Record<string, string> = {};
    for (const r of ROLES) {
      const v = picksIn?.[r];
      if (typeof v === "string" && v) picks[r] = v;
    }
    if (Object.keys(picks).length === 0)
      throw new BadRequestException("최소 1개 역할은 선택해야 합니다.");
    await this.upsert(visitorId, "tier", picks);
    return { ok: true, picks };
  }

  /**
   * 특정 방문자의 티어 투표를 조회한다.
   * @param visitorId — 방문자 식별자(없으면 picks: null 반환)
   * @returns { picks } — 저장된 역할별 선택 또는 null
   */
  async getTierMine(visitorId: string) {
    if (!visitorId) return { picks: null };
    const row = await this.repo.findOne({ where: { visitorId, kind: "tier" } });
    return { picks: row?.payload ?? null };
  }

  /**
   * 전체 티어 투표를 집계해 역할별 상위 캐릭터를 반환한다.
   * 모든 투표를 순회하며 역할별로 캐릭터 득표 수를 세고, 득표순 정렬 후 상위 limit 개만 추린다.
   * @param limit — 역할별로 반환할 상위 캐릭터 수. 기본 5
   * @returns { totalBallots, roles } — 전체 투표 수와 역할별 { characterId, votes } 배열
   */
  async getTier(limit = 5) {
    const rows = await this.repo.find({ where: { kind: "tier" } });
    const tally: Record<Role, Map<string, number>> = {
      tank: new Map(),
      melee: new Map(),
      ranged: new Map(),
      support: new Map(),
    };
    for (const row of rows) {
      const p = row.payload ?? {};
      for (const r of ROLES) {
        const id = p[r];
        if (typeof id === "string" && id) tally[r].set(id, (tally[r].get(id) ?? 0) + 1);
      }
    }
    const roles: Record<Role, { characterId: string; votes: number }[]> = {
      tank: [],
      melee: [],
      ranged: [],
      support: [],
    };
    for (const r of ROLES) {
      roles[r] = [...tally[r].entries()]
        .map(([characterId, votes]) => ({ characterId, votes }))
        .sort((a, b) => b.votes - a.votes)
        .slice(0, limit);
    }
    return { totalBallots: rows.length, roles };
  }

  /* ---- 조합 티어 투표 (편성 선택 + 슬롯별 캐릭터) ---- */

  /**
   * 조합(편성) 투표를 저장한다. 편성 키의 유효성, 슬롯 수 일치, 빈 값/중복 캐릭터를 검증한다.
   * @param visitorId — 방문자 식별자
   * @param formationKey — 편성 키(FORMATION_MAP 에 없으면 400 예외)
   * @param idsIn — 슬롯별 캐릭터 id 배열(임의 입력). 개수 불일치·빈 값 시 400, 중복 시 400 예외
   * @returns 저장 결과({ ok: true, formationKey, ids })
   */
  async saveComp(visitorId: string, formationKey: string, idsIn: any) {
    const formation = FORMATION_MAP[formationKey];
    if (!formation) throw new BadRequestException("올바르지 않은 편성입니다.");
    const ids: string[] = Array.isArray(idsIn) ? idsIn.map((x) => String(x || "")) : [];
    if (ids.length !== formation.roles.length || ids.some((x) => !x))
      throw new BadRequestException(`캐릭터 ${formation.roles.length}명을 모두 선택해야 합니다.`);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException("같은 캐릭터를 중복 선택할 수 없습니다.");
    await this.upsert(visitorId, "comp", { formationKey, ids });
    return { ok: true, formationKey, ids };
  }

  /**
   * 특정 방문자의 조합 투표를 조회한다.
   * @param visitorId — 방문자 식별자(없으면 comp: null 반환)
   * @returns { comp } — 저장된 조합({ formationKey, ids }) 또는 null
   */
  async getCompMine(visitorId: string) {
    if (!visitorId) return { comp: null };
    const row = await this.repo.findOne({ where: { visitorId, kind: "comp" } });
    return { comp: row?.payload ?? null };
  }

  /**
   * 전체 조합 투표를 집계해 인기 조합 상위를 반환한다.
   * 캐릭터 id 를 정렬한 시그니처로 동일 조합을 묶어 득표를 합산하고, 득표순 상위 limit 개를 추린다.
   * @param limit — 반환할 상위 조합 수. 기본 6
   * @returns { totalBallots, distinctCombos, top } — 전체 투표 수·고유 조합 수·상위 조합 목록
   */
  async getComp(limit = 6) {
    const rows = await this.repo.find({ where: { kind: "comp" } });
    const combos = new Map<string, { ids: string[]; votes: number; formationKey: string }>();
    for (const row of rows) {
      const ids: string[] = Array.isArray(row.payload?.ids) ? row.payload.ids.map(String) : [];
      if (!ids.length) continue;
      const sig = [...ids].sort().join("-");
      let e = combos.get(sig);
      if (!e) {
        e = { ids, votes: 0, formationKey: row.payload?.formationKey ?? "" };
        combos.set(sig, e);
      }
      e.votes++;
    }
    const top = [...combos.values()].sort((a, b) => b.votes - a.votes).slice(0, limit);
    return { totalBallots: rows.length, distinctCombos: combos.size, top };
  }
}
