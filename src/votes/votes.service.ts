import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Vote } from "../database/entities";
import { FORMATION_MAP, type Role } from "../meta/formations";

/* eslint-disable @typescript-eslint/no-explicit-any */

const ROLES: Role[] = ["tank", "melee", "ranged", "support"];

@Injectable()
export class VotesService {
  constructor(@InjectRepository(Vote) private readonly repo: Repository<Vote>) {}

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

  async getTierMine(visitorId: string) {
    if (!visitorId) return { picks: null };
    const row = await this.repo.findOne({ where: { visitorId, kind: "tier" } });
    return { picks: row?.payload ?? null };
  }

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

  async getCompMine(visitorId: string) {
    if (!visitorId) return { comp: null };
    const row = await this.repo.findOne({ where: { visitorId, kind: "comp" } });
    return { comp: row?.payload ?? null };
  }

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
