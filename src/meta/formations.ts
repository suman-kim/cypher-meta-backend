/**
 * 조합(팀 편성) 프리셋 정의 파일.
 *
 * 조합 투표 기능에서 사용하는 5인 역할 편성 프리셋들을 정의한다. 각 프리셋은
 * 역할별 인원수(counts)와 슬롯 전개 순서(roles)를 가지며, 프론트엔드(lib/votes.ts)와
 * key 를 반드시 일치시켜야 서로 참조가 맞는다. FORMATION_MAP 으로 key 기반 빠른 조회를 제공한다.
 *
 * 두 체계를 함께 둔다(롤백 대비):
 *  - FORMATIONS          : 기존 포지션(탱커/근딜/원딜/서포터) 프리셋 — legacy
 *  - OFFICIAL_FORMATIONS : 공식 역할군 프리셋 — official (GET /votes/official/formations 로 노출)
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

/* ------------------------------------------------------------------ */
/* 공식 역할군 편성 프리셋 (POSITION_SYSTEM=official)                    */
/* ------------------------------------------------------------------ */

/**
 * 공식 역할군 5인 편성 프리셋 1개.
 * roles 는 공식 역할군 한글명(character_ultimates.officialRole)을 슬롯 순서대로 나열한다.
 */
export interface OfficialFormation {
  // 프리셋 고유 키 — 역할군 머리글자 조합(V=뱅가드, S=스트라이커, K=스커미셔, R=리퍼, G=레인저, A=아틸러리, C=컨트롤러)
  key: string;
  // 사람이 읽는 라벨 (예: "뱅가드·스트라이커·리퍼·레인저·컨트롤러")
  label: string;
  // 슬롯별 공식 역할군(전방 → 후방 → 지원 순)
  roles: string[];
}

/**
 * 공식 편성 프리셋 목록.
 * 실제 공식전 5인 팀의 역할군 구성 빈도 상위 6개로 정했다(2026-09-30, 로컬 표본 약 9천 팀).
 * 표본이 쌓이면 빈도를 다시 보고 조정한다. 투표 payload 가 key 를 참조하므로 key 는 바꾸지 말 것.
 */
export const OFFICIAL_FORMATIONS: OfficialFormation[] = [
  { key: "VSRGC", label: "뱅가드·스트라이커·리퍼·레인저·컨트롤러", roles: ["뱅가드", "스트라이커", "리퍼", "레인저", "컨트롤러"] },
  { key: "VSKGC", label: "뱅가드·스트라이커·스커미셔·레인저·컨트롤러", roles: ["뱅가드", "스트라이커", "스커미셔", "레인저", "컨트롤러"] },
  { key: "VVRGC", label: "뱅가드2·리퍼·레인저·컨트롤러", roles: ["뱅가드", "뱅가드", "리퍼", "레인저", "컨트롤러"] },
  { key: "VVKGC", label: "뱅가드2·스커미셔·레인저·컨트롤러", roles: ["뱅가드", "뱅가드", "스커미셔", "레인저", "컨트롤러"] },
  { key: "VVSKG", label: "뱅가드2·스트라이커·스커미셔·레인저", roles: ["뱅가드", "뱅가드", "스트라이커", "스커미셔", "레인저"] },
  { key: "VVSRG", label: "뱅가드2·스트라이커·리퍼·레인저", roles: ["뱅가드", "뱅가드", "스트라이커", "리퍼", "레인저"] },
];

/** 공식 편성 key → 프리셋 조회 맵 */
export const OFFICIAL_FORMATION_MAP: Record<string, OfficialFormation> = Object.fromEntries(
  OFFICIAL_FORMATIONS.map((f) => [f.key, f]),
);
