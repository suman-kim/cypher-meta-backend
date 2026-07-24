/**
 * 조합(팀 편성) 프리셋 정의 파일.
 *
 * 조합 투표 기능에서 사용하는 5인 역할 편성 프리셋들을 정의한다. 각 프리셋은
 * 역할별 인원수(counts)와 슬롯 전개 순서(roles)를 가지며, 프론트엔드(lib/votes.ts)와
 * key 를 반드시 일치시켜야 서로 참조가 맞는다. FORMATION_MAP 으로 key 기반 빠른 조회를 제공한다.
 */
/** 조합 투표용 역할 편성(5인) 프리셋. 프론트(lib/votes.ts)와 key 를 일치시킬 것. */

/**
 * 편성 슬롯의 역할 코드.
 * - "tank": 탱커
 * - "melee": 근접딜러
 * - "ranged": 원거리딜러
 * - "support": 서포터
 */
export type Role = "tank" | "melee" | "ranged" | "support";

/**
 * 하나의 팀 편성 프리셋.
 */
export interface Formation {
  // 프리셋 고유 키 (프론트와 일치시켜야 하는 식별자)
  key: string;
  // 사람이 읽는 편성 라벨 (예: "탱2·근1·원1·서1")
  label: string;
  // 역할별 배정 인원수 (합계 5)
  counts: Record<Role, number>;
  /** 슬롯 역할 순서 (탱커→근접→원거리→서포터 순으로 전개) */
  roles: Role[];
}

/**
 * 역할 전개 순서. counts 를 roles 배열로 펼칠 때 이 순서대로 나열한다.
 * (탱커 → 근접딜러 → 원거리딜러 → 서포터)
 */
const ROLE_ORDER: Role[] = ["tank", "melee", "ranged", "support"];

/**
 * 역할별 인원수 맵을 슬롯 역할 배열로 펼친다.
 * @param counts — 역할별 배정 인원수 맵.
 * @returns ROLE_ORDER 순서로 각 역할을 인원수만큼 반복해 나열한 역할 배열.
 */
function expand(counts: Record<Role, number>): Role[] {
  const out: Role[] = [];
  for (const r of ROLE_ORDER) for (let i = 0; i < (counts[r] ?? 0); i++) out.push(r);
  return out;
}

/**
 * Formation 객체를 생성하는 팩토리. counts 를 펼쳐 roles 를 함께 채운다.
 * @param key — 프리셋 고유 키.
 * @param label — 사람이 읽는 편성 라벨.
 * @param counts — 역할별 배정 인원수 맵.
 * @returns key·label·counts 와 전개된 roles 를 담은 Formation.
 */
function make(key: string, label: string, counts: Record<Role, number>): Formation {
  return { key, label, counts, roles: expand(counts) };
}

/**
 * 사용 가능한 팀 편성 프리셋 목록.
 * 각 항목은 5인 조합을 나타내며 역할 배분이 다르다.
 * - "std": 표준(탱2·근1·원1·서1)
 * - "poke": 포킹(탱2·원2·서1)
 * - "bruiser": 브루저(탱2·근2·서1)
 * - "dive": 다이브(탱1·근1·원2·서1)
 * - "heavytank": 헤비탱크(탱3·근1·원1)
 * - "doublepoke": 더블포크(탱2·근1·원2)
 */
export const FORMATIONS: Formation[] = [
  make("std", "탱2·근1·원1·서1", { tank: 2, melee: 1, ranged: 1, support: 1 }),
  make("poke", "탱2·원2·서1", { tank: 2, melee: 0, ranged: 2, support: 1 }),
  make("bruiser", "탱2·근2·서1", { tank: 2, melee: 2, ranged: 0, support: 1 }),
  make("dive", "탱1·근1·원2·서1", { tank: 1, melee: 1, ranged: 2, support: 1 }),
  make("heavytank", "탱3·근1·원1", { tank: 3, melee: 1, ranged: 1, support: 0 }),
  make("doublepoke", "탱2·근1·원2", { tank: 2, melee: 1, ranged: 2, support: 0 }),
];

/**
 * 프리셋 key → Formation 조회 맵.
 * FORMATIONS 를 key 기준으로 인덱싱해 O(1) 조회를 제공한다.
 */
export const FORMATION_MAP: Record<string, Formation> = Object.fromEntries(
  FORMATIONS.map((f) => [f.key, f]),
);
