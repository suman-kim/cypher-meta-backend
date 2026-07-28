/**
 * role-resolver.ts
 * ---------------------------------------------------------------------------
 * "이 판에서 이 플레이어의 포지션" 3단 판별기.
 *
 * 사이퍼즈는 포지션 선택이 없고 Neople API 도 포지션을 주지 않는다(실측 확인).
 * 그래서 아래 순서로 판별한다:
 *   1차 static — 캐릭터 정적 분류(ROLE_BY_NAME). 절대 다수의 판에서 정확.
 *   2차 stat   — 경기 스탯 보정. 신호가 확실할 때만 정적 분류를 뒤집는다(보수적).
 *   3차 item   — 아이템 신호(운영자 도메인 지식):
 *     · 1순위 = 착용 목걸이(목 슬롯 107). 공목걸이/방목걸이는 그 판의 운용 방향을
 *       플레이어가 직접 선택한 것이라 양방향으로 신뢰한다.
 *       [불변식] 방목걸이 착용 판의 최종 역할은 "무조건" 탱커 또는 서포터다 —
 *       다른 어떤 규칙(정적/스탯/순서)이 뭐라 하든 마지막에 강제된다.
 *       방목걸이 → 탱폿 라인 보정(원딜→서포터, 근딜→탱커, 힐량 높으면 서포터 우선),
 *       공목걸이 → 딜러 라인 보정(탱커→근접딜러, 서포터→원거리딜러 — 근접/원거리
 *       축을 그대로 잇는 대칭 매핑). 정적 분류와 같은 라인이면 뒤집지 않는다.
 *     · 2순위(목걸이 판별 불가 시) = 옷(가슴)·허리·바지(다리) 선마스터 경향.
 *       탱커·서포터가 방어 슬롯을 먼저 마스터하는 경향만 신호로 쓰고,
 *       반대 방향(손/모자 선마스터 → 딜러)은 쓰지 않는다 — 공격 아이템은
 *       탱커·서포터도 흔히 먼저 올리기 때문(운영자 확인).
 *
 * 우선순위: 3차(item) > 2차(stat) > 1차(static). 뒤 단계일수록 "그 판의 실제 행동"에
 * 가까운 증거라서 앞 단계를 덮어쓴다. 판별 근거는 roleSource 로 저장해 나중에
 * 정확도 검증/임계값 튜닝에 쓴다.
 *
 * 목걸이 공/방 판별은 NecklaceService(아이템 상세 파싱, 종류당 1회 캐시)가 담당하고,
 * 이 모듈은 그 결과(neckType)를 받아 순수 함수로 판정만 한다.
 */
import { classifyRole, CharacterRole, RoleOrEtc } from "./character-roles";

/** 목걸이 성향: atk=공격형(공목걸이) / def=방어형(방목걸이). NecklaceService 가 판별해 전달. */
export type NeckType = "atk" | "def";

/** 판별에 쓰는 경기 스탯(매치 상세 playInfo 에서 추출한 압축본). */
export interface MatchStatSnapshot {
  attackPoint: number;
  damagePoint: number;
  battlePoint: number;
  sightPoint: number;
  towerAttackPoint: number;
  healAmount: number;
  backAttackCount: number;
  comboCount: number;
}

/** 최종 장착 아이템에서 슬롯 매핑에 필요한 최소 형태(원본 jsonb 그대로 받는다). */
export interface EquippedItemRef {
  itemId?: unknown;
  slotCode?: unknown;
  equipSlotCode?: unknown;
}

/** 판별 결과: 역할 + 근거. */
export interface RoleResolution {
  role: RoleOrEtc;
  source: "static" | "stat" | "item";
}

/* ------------------------------------------------------------------ 슬롯 상수 */

/** 목 슬롯(목걸이). */
const NECK_SLOT = "107";
/** 방어 라인 슬롯: 가슴(옷)=103 · 허리=104 · 다리(바지)=105. */
const DEF_SLOTS = new Set(["103", "104", "105"]);
/** 딜러 라인 슬롯: 손=101 · 머리(모자)=102. (순서 규칙에서는 우세 비교용으로만 사용) */
const ATK_SLOTS = new Set(["101", "102"]);

/** 최종 장착 목록에서 목걸이 itemId 를 찾는다(없으면 null). */
export function findNeckItemId(items: EquippedItemRef[] | null | undefined): string | null {
  for (const it of items ?? []) {
    const slot = String(it?.slotCode ?? it?.equipSlotCode ?? "");
    if (slot === NECK_SLOT && it?.itemId != null) return String(it.itemId);
  }
  return null;
}

/* ------------------------------------------------------------------ 2차: 스탯 보정 */

/**
 * 스탯 보정 임계값 — 보수적 초기값. 실데이터 분포가 쌓이면 조정한다.
 * 애매하면 절대 뒤집지 않는 것이 원칙.
 */
const STAT_RULES = {
  /** 힐량이 이 값 이상이고 공격점수보다 크면 그 판은 서포터로 본다. */
  HEAL_SUPPORT_MIN: 10000,
} as const;

/** 2차: 스탯이 확실할 때만 역할을 보정. 아니면 null(보정 없음). */
function resolveByStats(stats: MatchStatSnapshot | null | undefined): CharacterRole | null {
  if (!stats) return null;
  if (stats.healAmount >= STAT_RULES.HEAL_SUPPORT_MIN && stats.healAmount > stats.attackPoint) {
    return "support";
  }
  return null;
}

/* ------------------------------------------------------------------ 3차: 아이템 신호 */

/**
 * 아이템 규칙 임계값 — 보수적 초기값(데이터 분포 보고 조정).
 * 발(106)·목(107)·장신구(2xx)·킷(3xx)은 순서 규칙 판정에서 중립으로 제외한다.
 */
const ITEM_RULES = {
  /** 구매 순서 앞에서 몇 개까지 볼지 ("먼저 마스터" 경향 구간). */
  HEAD_PURCHASES: 10,
  /** 순서 규칙 판정에 필요한 최소 매핑 표본. 미만이면 판정 포기. */
  MIN_SAMPLES: 4,
  /** 순서 규칙에서 방어 우세 판정에 필요한 차이(동률·근소 우세는 포기). */
  MIN_MARGIN: 2,
  /** 탱폿 라인 내 탱/폿 구분: 힐량이 이 값 이상이면 서포터. */
  SOFT_HEAL_SUPPORT: 5000,
} as const;

/** 역할 → 라인(방어/딜러). etc 는 라인 없음. */
function lineOf(role: RoleOrEtc): "def" | "atk" | null {
  if (role === "tank" || role === "support") return "def";
  if (role === "melee" || role === "ranged") return "atk";
  return null;
}

/**
 * 탱폿 라인 내 세부 역할(탱/폿) 결정.
 * 1) 힐량이 임계 이상이면 무조건 서포터(직접 증거 우선).
 * 2) 아니면 캐릭터 원래 성격으로: 서포터·원거리딜러 → 서포터(유틸형 운용),
 *    탱커·근접딜러·미분류 → 탱커(브루저형 운용). — 운영자 도메인 규칙.
 */
function defRole(stats: MatchStatSnapshot | null | undefined, staticRole: RoleOrEtc): CharacterRole {
  if ((stats?.healAmount ?? 0) >= ITEM_RULES.SOFT_HEAL_SUPPORT) return "support";
  return staticRole === "support" || staticRole === "ranged" ? "support" : "tank";
}

/**
 * 딜러 라인 내 세부 역할(근딜/원딜) 결정 — 운영자 도메인 규칙(대칭 매핑).
 * 탱커(근접 축) → 근접딜러, 서포터(원거리 축) → 원거리딜러, 미분류 → 근접딜러.
 * (정적 분류가 이미 딜러인 캐릭터는 이 함수에 도달하지 않는다 — 같은 라인 유지)
 */
function atkRole(staticRole: RoleOrEtc): CharacterRole {
  return staticRole === "support" ? "ranged" : "melee";
}

/**
 * 3차: 아이템 신호 판별.
 * 1순위 목걸이(양방향) → 2순위 옷/허리/바지 선마스터(방어 단방향).
 * 정적 분류와 같은 라인이거나 신호가 불충분하면 null(보정 없음).
 */
function resolveByItems(
  itemPurchase: string[] | null | undefined,
  items: EquippedItemRef[] | null | undefined,
  stats: MatchStatSnapshot | null | undefined,
  staticRole: RoleOrEtc,
  neckType: NeckType | null | undefined,
): CharacterRole | null {
  const sLine = lineOf(staticRole);

  // ── 1순위: 착용 목걸이(양방향 신뢰) ──────────────────────────────
  if (neckType === "def") {
    return sLine === "def" ? null : defRole(stats, staticRole);
  }
  if (neckType === "atk") {
    return sLine === "atk" ? null : atkRole(staticRole);
  }

  // ── 2순위: 옷/허리/바지 선마스터 경향(방어 방향만, 목걸이 불명 시) ──
  if (!itemPurchase?.length || !items?.length) return null;

  const slotById = new Map<string, string>();
  for (const it of items) {
    const id = it?.itemId != null ? String(it.itemId) : null;
    const slot = it?.slotCode ?? it?.equipSlotCode;
    if (id && slot != null) slotById.set(id, String(slot));
  }

  let def = 0;
  let atk = 0;
  let samples = 0;
  for (const raw of itemPurchase.slice(0, ITEM_RULES.HEAD_PURCHASES)) {
    const slot = slotById.get(String(raw));
    if (!slot) continue; // 교체되어 버린 아이템 등 매핑 불가 → 제외
    if (DEF_SLOTS.has(slot)) {
      def++;
      samples++;
    } else if (ATK_SLOTS.has(slot)) {
      atk++;
      samples++;
    }
  }
  if (samples < ITEM_RULES.MIN_SAMPLES) return null;

  // 단방향: 방어 슬롯 선마스터가 뚜렷할 때만 보정.
  // (손/모자 우세 → 딜러 보정은 하지 않음 — 공격 아이템은 전 포지션이 흔히 올림)
  if (def < atk + ITEM_RULES.MIN_MARGIN) return null;
  if (sLine === "def") return null; // 이미 탱폿 라인이면 유지

  return defRole(stats, staticRole);
}

/* ------------------------------------------------------------------ 통합 판별 */

/**
 * 이 판에서의 포지션을 3단으로 판별한다.
 * @param characterName — 사용 캐릭터명(1차 정적 분류 키).
 * @param stats — 경기 스탯 압축본(2차 + 라인 내 세부 판정 보조). 없으면 건너뜀.
 * @param itemPurchase — 아이템 구매 순서 itemId 배열(3차 2순위). 없으면 건너뜀.
 * @param items — 최종 장착 아이템 배열(3차의 슬롯 매핑용). 없으면 순서 규칙 건너뜀.
 * @param neckType — 착용 목걸이 성향(NecklaceService 판별 결과, 3차 1순위). 없으면 순서 규칙으로.
 */
export function resolveRole(
  characterName: string | null | undefined,
  stats?: MatchStatSnapshot | null,
  itemPurchase?: string[] | null,
  items?: EquippedItemRef[] | null,
  neckType?: NeckType | null,
): RoleResolution {
  const staticRole = classifyRole(characterName ?? "");

  let out: RoleResolution;
  const byItem = resolveByItems(itemPurchase, items, stats, staticRole, neckType);
  const byStat = byItem ? null : resolveByStats(stats);
  if (byItem) out = { role: byItem, source: "item" };
  else if (byStat && byStat !== staticRole) out = { role: byStat, source: "stat" };
  else out = { role: staticRole, source: "static" };

  // [불변식] 방목걸이 착용 판은 최종 역할이 반드시 탱커/서포터여야 한다.
  // 위 규칙들이 어떤 경로를 타든 마지막에 강제한다(힐량으로 탱/폿 결정).
  if (neckType === "def" && out.role !== "tank" && out.role !== "support") {
    out = { role: defRole(stats, staticRole), source: "item" };
  }
  return out;
}
