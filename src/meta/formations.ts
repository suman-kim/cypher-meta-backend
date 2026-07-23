/** 조합 투표용 역할 편성(5인) 프리셋. 프론트(lib/votes.ts)와 key 를 일치시킬 것. */
export type Role = "tank" | "melee" | "ranged" | "support";

export interface Formation {
  key: string;
  label: string;
  counts: Record<Role, number>;
  /** 슬롯 역할 순서 (탱커→근접→원거리→서포터 순으로 전개) */
  roles: Role[];
}

const ROLE_ORDER: Role[] = ["tank", "melee", "ranged", "support"];

function expand(counts: Record<Role, number>): Role[] {
  const out: Role[] = [];
  for (const r of ROLE_ORDER) for (let i = 0; i < (counts[r] ?? 0); i++) out.push(r);
  return out;
}

function make(key: string, label: string, counts: Record<Role, number>): Formation {
  return { key, label, counts, roles: expand(counts) };
}

export const FORMATIONS: Formation[] = [
  make("std", "탱2·근1·원1·서1", { tank: 2, melee: 1, ranged: 1, support: 1 }),
  make("poke", "탱2·원2·서1", { tank: 2, melee: 0, ranged: 2, support: 1 }),
  make("bruiser", "탱2·근2·서1", { tank: 2, melee: 2, ranged: 0, support: 1 }),
  make("dive", "탱1·근1·원2·서1", { tank: 1, melee: 1, ranged: 2, support: 1 }),
  make("heavytank", "탱3·근1·원1", { tank: 3, melee: 1, ranged: 1, support: 0 }),
  make("doublepoke", "탱2·근1·원2", { tank: 2, melee: 1, ranged: 2, support: 0 }),
];

export const FORMATION_MAP: Record<string, Formation> = Object.fromEntries(
  FORMATIONS.map((f) => [f.key, f]),
);
