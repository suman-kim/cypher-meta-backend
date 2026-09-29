/**
 * ultimate.service.ts
 * ---------------------------------------------------------------------------
 * 1차/2차 궁극기 판별 서비스.
 *
 * Neople 매치 응답은 "그 판에 어느 궁극기를 썼는지"를 주지 않는다(role[]는 매 판 1st·2nd 전체가 옴).
 * 대신 장착 아이템 중 한쪽 궁극기만 강화하는 캐릭터 전용 아이템이 있어, 그것으로 판별한다.
 *  - character_ultimates : 캐릭터별 1차/2차 궁극기 스킬명·공식 역할군 (기준 표, 시드 139행)
 *  - ultimate_items      : 아이템 ID → 1차/2차 (옵션 설명의 "스킬명(E)"으로 자동 분류)
 *  - match_players.ultimateType : 판별 결과 저장 (집계는 이 컬럼만 읽는다)
 *
 * 흐름
 *  1) 부팅: 테이블 보장 → 시드 동기화(없는 행 추가·검수 표시) → 규칙 캐시 적재
 *  2) 수집: prepareItems()로 처음 보는 아이템만 학습 → resolve()로 판별
 *  3) 관리: rebuildItems()로 아이템 표 재구축 → backfill()로 과거 match_players 일괄 갱신
 *
 * 기존 포지션(role/roleSource) 판별·수집과는 독립적이다(롤백 대비로 둘 다 유지).
 */
import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, Repository, Table } from "typeorm";
import { CharacterUltimate, UltimateItem, type UltimateType } from "../database/entities";
import { NeopleService } from "../neople/neople.service";
import { ULTIMATE_SEED } from "./ultimate-seed";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 학습 대상 희귀도 코드 — 레어(103)·유니크(104)·레전드리(105). 캐릭터 전용 판별 아이템은 모두 이 구간 */
const LEARN_RARITY = new Set(["103", "104", "105"]);
/** /multi/battleitems 1회 최대 아이템 수 (Neople 제한) */
const MULTI_LIMIT = 30;

/** 캐릭터 1명의 궁극기 판별 규칙 (정규화된 스킬명) */
interface CharacterRule {
  /** 2차 궁극기가 있는지 */
  dual: boolean;
  /** 1차 궁극기 스킬명 (공백 제거) */
  first: string;
  /** 2차 궁극기 스킬명 (공백 제거, 1차만 있으면 null) */
  second: string | null;
}

/** backfill() 결과 요약 */
export interface BackfillResult {
  /** 1차만 있는 캐릭터 → 1st 로 채운 행 수 */
  single: number;
  /** 아이템으로 1st 판별된 행 수 */
  first: number;
  /** 아이템으로 2nd 판별된 행 수 */
  second: number;
  /** 판별 불가(null) 행 수 */
  unknown: number;
}

/**
 * 스킬명 비교용 정규화 — 공백 제거.
 * (아이템 옵션에는 "용창 비전식 용성락"처럼 무기명 접두사·띄어쓰기가 섞여 있어 공백을 무시하고 비교한다)
 * @param s — 원문 스킬명
 * @returns 공백을 모두 제거한 문자열
 */
function normalizeSkill(s: string): string {
  return s.replace(/\s+/g, "");
}

/**
 * 아이템 옵션 설명에서 "(E)"로 표기된 궁극기 스킬명을 모두 뽑는다.
 * 예: "[2레벨] ... \n절명참철도(E) 인간추가공격력 : +6%" → ["절명참철도"]
 * @param explainDetail — /battleitems 상세의 explainDetail 원문
 * @returns 정규화(공백 제거)된 스킬명 목록(중복 제거)
 */
export function extractUltimateSkills(explainDetail: string | null | undefined): string[] {
  if (!explainDetail) return [];
  const out = new Set<string>();
  for (const line of explainDetail.split("\n")) {
    for (const m of line.matchAll(/([^:/[\]()]+?)\s?\(E\)/g)) {
      const name = normalizeSkill(m[1]);
      // "+30%" 같은 수치·"coin" 등 스킬명이 아닌 토큰은 버린다
      if (name && !/^[-+]?\d/.test(name) && name !== "coin" && name !== "동안") out.add(name);
    }
  }
  return [...out];
}

/**
 * 옵션에서 뽑은 스킬명이 기준 스킬명과 같은지 판정한다.
 * 한쪽이 무기명 접두사를 포함할 수 있어 "끝부분 일치"로 비교한다(예: 용창비전식용성락 ↔ 비전식용성락).
 * @param token — 옵션에서 뽑은 스킬명(정규화됨)
 * @param skill — 기준 스킬명(정규화됨)
 * @returns 같은 스킬이면 true
 */
function sameSkill(token: string, skill: string): boolean {
  return token.endsWith(skill) || skill.endsWith(token);
}

/** 1차/2차 궁극기 판별 서비스 */
@Injectable()
export class UltimateService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UltimateService.name);

  /** characterId → 판별 규칙 (character_ultimates 캐시) */
  private rules = new Map<string, CharacterRule>();
  /** characterId → 궁극기별 공식 역할군 (1st 필수, 2nd 는 없으면 null) */
  private roles = new Map<string, { first: string; second: string | null }>();
  /** itemId → 가리키는 궁극기 (null = 확인 완료·중립). 맵에 없으면 아직 학습 안 한 아이템 */
  private itemTypes = new Map<string, UltimateType | null>();
  /** 최초 준비(테이블·시드·캐시) 1회 보장용 */
  private readyPromise: Promise<void> | null = null;

  /**
   * @param ultRepo — character_ultimates 리포지토리
   * @param itemRepo — ultimate_items 리포지토리
   * @param dataSource — 테이블 생성·원시 SQL(backfill) 실행용
   * @param neople — 아이템 상세(/multi/battleitems) 조회용 Neople 프록시
   */
  constructor(
    @InjectRepository(CharacterUltimate) private readonly ultRepo: Repository<CharacterUltimate>,
    @InjectRepository(UltimateItem) private readonly itemRepo: Repository<UltimateItem>,
    private readonly dataSource: DataSource,
    private readonly neople: NeopleService,
  ) {}

  /** 부팅 시 테이블·시드·규칙 캐시를 준비한다. 실패해도 앱은 뜨게 두고 로그만 남긴다. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.ensureReady();
      this.logger.log(`궁극기 판별 준비 완료 (캐릭터 ${this.rules.size}명, 판별 아이템 ${this.itemTypes.size}종)`);
    } catch (e) {
      this.logger.error(`궁극기 판별 초기화 실패: ${(e as Error).message}`);
    }
  }

  /**
   * 테이블 생성 → 시드 → 캐시 적재를 최초 1회만 수행한다(동시 호출 안전).
   * @returns 준비 완료 시 resolve 되는 Promise
   */
  ensureReady(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        await this.ensureTables();
        await this.syncSeed();
        await this.loadRules();
      })().catch((e) => {
        this.readyPromise = null; // 실패 시 다음 호출에서 재시도
        throw e;
      });
    }
    return this.readyPromise;
  }

  /**
   * character_ultimates / ultimate_items 테이블을 엔티티 메타데이터로 idempotent 생성한다.
   * (운영 DB_SYNC=false 대응 — CollectionConfigService.ensureTables 와 같은 패턴)
   */
  private async ensureTables(): Promise<void> {
    const qr = this.dataSource.createQueryRunner();
    try {
      await qr.connect();
      for (const Entity of [CharacterUltimate, UltimateItem]) {
        const meta = this.dataSource.getMetadata(Entity);
        if (!(await qr.hasTable(meta.tableName))) {
          await qr.createTable(Table.create(meta, this.dataSource.driver), true, false, true);
          this.logger.log(`테이블 생성: ${meta.tableName}`);
        }
      }
    } finally {
      await qr.release();
    }
  }

  /**
   * ULTIMATE_SEED 를 DB 에 맞춘다 — 없는 행만 추가하고, 시드가 검수 완료인 행은 verified 를 true 로 올린다.
   * 스킬명·역할군은 덮어쓰지 않는다(운영에서 고친 값 보존). 신규 캐릭터·2차 궁극기는 시드에 추가하면 반영된다.
   */
  private async syncSeed(): Promise<void> {
    const existing = await this.ultRepo.find({ select: ["characterId", "ultimateType", "verified"] });
    const byKey = new Map(existing.map((e) => [`${e.characterId}:${e.ultimateType}`, e]));
    const missing = ULTIMATE_SEED.filter((r) => !byKey.has(`${r.characterId}:${r.ultimateType}`));
    if (missing.length) await this.ultRepo.insert(missing);
    let verifiedUp = 0;
    for (const r of ULTIMATE_SEED) {
      const e = byKey.get(`${r.characterId}:${r.ultimateType}`);
      if (e && r.verified && !e.verified) {
        await this.ultRepo.update({ characterId: r.characterId, ultimateType: r.ultimateType }, { verified: true });
        verifiedUp++;
      }
    }
    if (missing.length || verifiedUp)
      this.logger.log(`character_ultimates 시드 동기화: 추가 ${missing.length}행, 검수 표시 ${verifiedUp}행`);
  }

  /**
   * DB 의 두 표를 메모리 캐시로 다시 읽는다. 표를 직접 수정한 뒤 호출하면 즉시 반영된다.
   * @returns 적재된 캐릭터 수·아이템 수
   */
  async loadRules(): Promise<{ characters: number; items: number }> {
    const ults = await this.ultRepo.find();
    const rules = new Map<string, CharacterRule>();
    const roles = new Map<string, { first: string; second: string | null }>();
    for (const u of ults) {
      const r = rules.get(u.characterId) ?? { dual: false, first: "", second: null };
      const ro = roles.get(u.characterId) ?? { first: "", second: null };
      if (u.ultimateType === "1st") {
        r.first = normalizeSkill(u.skillName);
        ro.first = u.officialRole;
      } else {
        r.second = normalizeSkill(u.skillName);
        r.dual = true;
        ro.second = u.officialRole;
      }
      rules.set(u.characterId, r);
      roles.set(u.characterId, ro);
    }
    this.roles = roles;
    const items = await this.itemRepo.find({ select: ["itemId", "ultimateType"] });
    this.rules = rules;
    this.itemTypes = new Map(items.map((i) => [i.itemId, i.ultimateType]));
    return { characters: rules.size, items: items.length };
  }

  /**
   * 캐릭터의 2차 궁극기 보유 여부.
   * @param characterId — 캐릭터 ID
   * @returns true=1차/2차 보유, false=1차만, null=기준 표에 없는 캐릭터
   */
  isDual(characterId: string): boolean | null {
    const r = this.rules.get(characterId);
    return r ? r.dual : null;
  }

  /**
   * 캐릭터·궁극기로 공식 역할군을 구한다.
   * 궁극기를 모르더라도(null) 1차/2차 역할군이 같거나 1차만 있으면 역할군이 확정된다.
   * @param characterId — 캐릭터 ID
   * @param ultimateType — "1st"/"2nd", 모르면 null
   * @returns 공식 역할군, 확정할 수 없으면 null(1차·2차 역할군이 다르고 궁극기 미상, 또는 표에 없음)
   */
  officialRoleOf(characterId: string, ultimateType: string | null | undefined): string | null {
    const ro = this.roles.get(characterId);
    if (!ro) return null;
    if (ultimateType === "1st") return ro.first;
    if (ultimateType === "2nd") return ro.second;
    if (!ro.second || ro.second === ro.first) return ro.first;
    return null;
  }

  /**
   * 한 판의 궁극기를 판별한다(동기 — 규칙 캐시만 사용).
   * 처음 보는 아이템이 있을 수 있으면 먼저 prepareItems()로 학습시켜야 정확하다.
   * @param characterId — 사용 캐릭터 ID
   * @param items — 그 판의 최종 장착 아이템 배열(Neople items[], itemId 필드 사용)
   * @returns "1st" | "2nd" | null(판별 불가: 표에 없는 캐릭터·근거 아이템 없음·양쪽 근거 충돌)
   */
  resolve(characterId: string, items: any[] | null | undefined): UltimateType | null {
    const rule = this.rules.get(characterId);
    if (!rule) return null;
    if (!rule.dual) return "1st"; // 2차 궁극기가 없는 캐릭터는 항상 1차
    let has1 = false;
    let has2 = false;
    for (const it of Array.isArray(items) ? items : []) {
      const t = this.itemTypes.get(String(it?.itemId ?? ""));
      if (t === "1st") has1 = true;
      else if (t === "2nd") has2 = true;
    }
    if (has1 === has2) return null; // 근거 없음 또는 충돌(분석상 0건)
    return has1 ? "1st" : "2nd";
  }

  /**
   * 수집한 판들의 장착 아이템 중 아직 학습하지 않은 것(레어 이상, 2차 궁극기 보유 캐릭터가 낀 것)을 학습한다.
   * 이미 표에 있는 아이템은 건너뛰므로, 평소에는 신규 시즌 아이템 정도만 API 를 호출한다.
   * @param players — { characterId, items } 목록 (match-parser 결과 등, items 는 Neople 장착 아이템 배열)
   * @returns 새로 학습한 아이템 수
   */
  async prepareItems(players: { characterId: string; items: unknown }[]): Promise<number> {
    await this.ensureReady();
    const unknown = new Set<string>();
    for (const p of players) {
      if (!this.rules.get(p.characterId)?.dual) continue;
      for (const it of (Array.isArray(p.items) ? p.items : []) as any[]) {
        const id = String(it?.itemId ?? "");
        if (id && !this.itemTypes.has(id) && LEARN_RARITY.has(String(it?.rarityCode ?? ""))) unknown.add(id);
      }
    }
    if (unknown.size === 0) return 0;
    return this.learnItems([...unknown]);
  }

  /**
   * 아이템 상세를 조회해 옵션의 궁극기 스킬명으로 1st/2nd/중립을 분류하고 ultimate_items 에 upsert 한다.
   * 한 아이템이 두 궁극기를 모두 언급하면 근거가 될 수 없으므로 중립(null)으로 둔다.
   * @param itemIds — 분류할 아이템 ID 목록(이미 있는 것도 다시 분류·갱신)
   * @returns 저장한 아이템 수
   */
  async learnItems(itemIds: string[]): Promise<number> {
    let saved = 0;
    for (let i = 0; i < itemIds.length; i += MULTI_LIMIT) {
      const chunk = itemIds.slice(i, i + MULTI_LIMIT);
      let rows: any[] = [];
      try {
        const raw: any = await this.neople.proxy(`/multi/battleitems?itemIds=${chunk.join(",")}`);
        rows = Array.isArray(raw?.rows) ? raw.rows : [];
      } catch (e) {
        // 한 묶음이 실패해도 나머지는 계속 — 실패분은 다음 수집 때 다시 시도된다(표에 안 들어가므로)
        this.logger.warn(`아이템 상세 조회 실패(${chunk.length}개): ${(e as Error).message}`);
        continue;
      }
      const entities = rows.map((r) => this.classifyItem(r));
      if (entities.length === 0) continue;
      await this.itemRepo.upsert(entities, ["itemId"]);
      for (const e of entities) this.itemTypes.set(e.itemId, e.ultimateType);
      saved += entities.length;
    }
    return saved;
  }

  /**
   * 아이템 상세 1건을 ultimate_items 행으로 변환한다(1st/2nd/중립 분류).
   * @param r — /multi/battleitems 의 rows[] 원소
   * @returns 저장할 UltimateItem 부분 객체
   */
  private classifyItem(r: any): Pick<UltimateItem, "itemId" | "characterId" | "ultimateType" | "matchedSkill" | "itemName" | "slotName"> {
    const characterId = String(r?.characterId ?? "");
    const rule = this.rules.get(characterId);
    let ultimateType: UltimateType | null = null;
    let matchedSkill: string | null = null;
    if (rule?.dual && rule.second) {
      const tokens = extractUltimateSkills(r?.explainDetail);
      const hit1 = tokens.find((t) => sameSkill(t, rule.first));
      const hit2 = tokens.find((t) => sameSkill(t, rule.second as string));
      if (hit1 && !hit2) [ultimateType, matchedSkill] = ["1st", hit1];
      else if (hit2 && !hit1) [ultimateType, matchedSkill] = ["2nd", hit2];
    }
    return {
      itemId: String(r?.itemId ?? ""),
      characterId,
      ultimateType,
      matchedSkill,
      itemName: r?.itemName ?? null,
      slotName: r?.slotName ?? null,
    };
  }

  /**
   * match_players 에 등장한 레어 이상 아이템(2차 궁극기 보유 캐릭터가 낀 것) 전체를 다시 분류한다.
   * character_ultimates 를 고친 뒤나 최초 도입 시 실행. 이어서 backfill() 을 돌려야 과거 판에 반영된다.
   * @returns 대상 아이템 수·저장 수
   */
  async rebuildItems(): Promise<{ targets: number; saved: number }> {
    await this.ensureReady();
    await this.loadRules();
    const dualIds = [...this.rules.entries()].filter(([, r]) => r.dual).map(([id]) => id);
    if (dualIds.length === 0) return { targets: 0, saved: 0 };
    const rows: { itemId: string }[] = await this.dataSource.query(
      `SELECT DISTINCT i->>'itemId' AS "itemId"
         FROM match_players mp
         CROSS JOIN LATERAL jsonb_array_elements(mp.items) i
        WHERE mp."characterId" = ANY($1)
          AND jsonb_typeof(mp.items) = 'array'
          AND i->>'rarityCode' = ANY($2)`,
      [dualIds, [...LEARN_RARITY]],
    );
    const saved = await this.learnItems(rows.map((r) => r.itemId).filter(Boolean));
    this.logger.log(`ultimate_items 재구축: 대상 ${rows.length}종, 저장 ${saved}종`);
    return { targets: rows.length, saved };
  }

  /**
   * 기존 match_players 전 행의 ultimateType 을 현재 규칙 표로 다시 채운다(멱등, 한 트랜잭션).
   *  1) 1차만 있는 캐릭터 → "1st"
   *  2) 2차 보유 캐릭터 → 장착 아이템을 ultimate_items 와 대조해 "1st"/"2nd", 근거 없으면 null
   * @returns 채운 결과 요약(1차 단일·1차·2차·판별 불가 행 수)
   */
  async backfill(): Promise<BackfillResult> {
    await this.ensureReady();
    await this.loadRules();
    const result = await this.dataSource.transaction(async (m) => {
      // 1) 1차만 있는 캐릭터
      await m.query(
        `UPDATE match_players SET "ultimateType" = '1st'
          WHERE "characterId" IN (
            SELECT "characterId" FROM character_ultimates GROUP BY "characterId" HAVING count(*) = 1)`,
      );
      // 2) 2차 보유 캐릭터 — 먼저 초기화 후 아이템 근거로 채움(규칙이 바뀌어도 결과가 남지 않도록)
      await m.query(
        `UPDATE match_players SET "ultimateType" = NULL
          WHERE "characterId" IN (SELECT "characterId" FROM character_ultimates WHERE "ultimateType" = '2nd')`,
      );
      await m.query(
        `WITH p AS (
           SELECT mp.id,
                  bool_or(ui."ultimateType" = '1st') AS h1,
                  bool_or(ui."ultimateType" = '2nd') AS h2
             FROM match_players mp
             CROSS JOIN LATERAL jsonb_array_elements(mp.items) i
             JOIN ultimate_items ui ON ui."itemId" = i->>'itemId' AND ui."ultimateType" IS NOT NULL
            WHERE jsonb_typeof(mp.items) = 'array'
              AND mp."characterId" IN (SELECT "characterId" FROM character_ultimates WHERE "ultimateType" = '2nd')
            GROUP BY mp.id)
         UPDATE match_players m
            SET "ultimateType" = CASE WHEN p.h1 AND NOT p.h2 THEN '1st'
                                      WHEN p.h2 AND NOT p.h1 THEN '2nd' END
           FROM p WHERE m.id = p.id`,
      );
      const counts: any[] = await m.query(
        `SELECT
           count(*) FILTER (WHERE mp."ultimateType" = '1st' AND NOT d.dual)::int AS single,
           count(*) FILTER (WHERE mp."ultimateType" = '1st' AND d.dual)::int     AS first,
           count(*) FILTER (WHERE mp."ultimateType" = '2nd')::int                AS second,
           count(*) FILTER (WHERE mp."ultimateType" IS NULL)::int                AS unknown
         FROM match_players mp
         LEFT JOIN (SELECT "characterId", count(*) > 1 AS dual FROM character_ultimates GROUP BY 1) d
           ON d."characterId" = mp."characterId"`,
      );
      return counts[0] as BackfillResult;
    });
    this.logger.log(`ultimateType backfill: ${JSON.stringify(result)}`);
    return result;
  }

  /**
   * 캐릭터별 궁극기 정의 목록(공식 역할군 포함)을 반환한다. 집계·화면에서 역할군을 붙일 때 사용.
   * @param characterIds — 특정 캐릭터만 조회할 때(생략 시 전체)
   * @returns character_ultimates 행 목록(캐릭터명·1st→2nd 순)
   */
  async list(characterIds?: string[]): Promise<CharacterUltimate[]> {
    await this.ensureReady();
    return this.ultRepo.find({
      where: characterIds?.length ? { characterId: In(characterIds) } : {},
      order: { characterName: "ASC", ultimateType: "ASC" },
    });
  }
}
