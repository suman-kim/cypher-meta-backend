/* Neople 매치 상세(raw) → matches / match_players 행으로 파싱 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { MatchStatSnapshot, resolveRole } from "./role-resolver";

/**
 * 파싱된 개별 플레이어 행. match_players 테이블에 저장할 한 명의 정보.
 */
export interface ParsedPlayer {
  // 플레이어 고유 ID (Neople playerId)
  playerId: string;
  // 플레이어 닉네임 (없으면 null)
  nickname: string | null;
  // 사용한 캐릭터(사이퍼) ID
  characterId: string;
  // 사용한 캐릭터(사이퍼) 이름 (없으면 null)
  characterName: string | null;
  // 경기 결과 문자열 ("win" | "lose" 등, 판별 불가 시 "unknown")
  result: string;
  // 게임 타입 ID ("rating" 등, 없으면 null)
  gameTypeId: string | null;
  // 처치 수
  killCount: number;
  // 사망 수
  deathCount: number;
  // 어시스트 수
  assistCount: number;
  // 장착 아이템 원본 배열 (없으면 null)
  items: unknown;
  // 게임 내 아이템 구매 순서 (itemId 배열, 없으면 null)
  itemPurchase: unknown;
  // 포지션 판별·분석용 경기 스탯 압축본 (없으면 null)
  stats: unknown;
  // 이 판에서의 판별 포지션 (tank/melee/ranged/support/etc)
  role: string;
  // 판별 근거 (static/stat/item)
  roleSource: string;
}
/**
 * 파싱된 매치 전체. matches 행 1개와 그에 속한 match_players 행 배열로 구성.
 */
export interface ParsedMatch {
  // matches 테이블에 저장할 매치 메타 정보
  match: {
    // 매치 고유 ID
    matchId: string;
    // 게임 타입 ID (판별 불가 시 "unknown")
    gameTypeId: string;
    // 맵 ID (없으면 null)
    mapId: string | null;
    // 맵 이름 (없으면 null)
    mapName: string | null;
    // 경기 시각 (파싱 불가/유효하지 않으면 null)
    playedAt: Date | null;
  };
  // 이 매치에 참가한 플레이어 행 목록
  players: ParsedPlayer[];
}

/**
 * Neople 매치 상세(raw) 응답을 DB 저장용 ParsedMatch 로 변환한다.
 *
 * teams[].players 는 playerId 문자열 배열 형태이고, 각 플레이어의 상세 스탯은 최상위 players[] 에 있어
 * 팀별 승패(result)를 playerId 로 매핑한 뒤 players[] 와 결합한다. playerId 와 characterId 가
 * 모두 있는 플레이어만 유효 행으로 남긴다.
 *
 * @param matchId — 저장할 매치의 고유 ID (호출자가 전달, 결과 match.matchId 로 사용).
 * @param detail — Neople /matches/{matchId} 상세 응답 원본 객체.
 * @returns 파싱된 ParsedMatch, 입력이 객체가 아니면 null.
 */
/** teams[].players 는 playerId 문자열배열, 상세는 최상위 players[] 에 있음 */
export function parseMatchDetail(matchId: string, detail: any): ParsedMatch | null {
  if (!detail || typeof detail !== "object") return null;

  const resultByPlayer = new Map<string, string>();
  for (const t of Array.isArray(detail.teams) ? detail.teams : []) {
    const res = t?.result;
    for (const entry of Array.isArray(t?.players) ? t.players : []) {
      const id = typeof entry === "string" ? entry : entry?.playerId;
      if (id && res) resultByPlayer.set(String(id), res);
    }
  }

  const players: ParsedPlayer[] = (Array.isArray(detail.players) ? detail.players : [])
    .map((p: any): ParsedPlayer => {
      const info = p?.playInfo ?? p ?? {};
      // 포지션 판별·분석용 경기 스탯 압축본(힐량·시야·딜량 등).
      const stats: MatchStatSnapshot = {
        attackPoint: Number(info.attackPoint ?? 0),
        damagePoint: Number(info.damagePoint ?? 0),
        battlePoint: Number(info.battlePoint ?? 0),
        sightPoint: Number(info.sightPoint ?? 0),
        towerAttackPoint: Number(info.towerAttackPoint ?? 0),
        healAmount: Number(info.healAmount ?? 0),
        backAttackCount: Number(info.backAttackCount ?? 0),
        comboCount: Number(info.comboCount ?? 0),
      };
      // 게임 내 아이템 구매 순서(itemId 배열). 없으면 null.
      const itemPurchase: string[] | null = Array.isArray(p?.itemPurchase)
        ? p.itemPurchase.map((x: unknown) => String(x))
        : null;
      const characterName = info.characterName ?? null;
      const equipped = Array.isArray(p?.items) ? p.items : null;
      // 3단 판별: 1차 캐릭터 정적 → 2차 스탯 보정 → 3차 아이템 구매 순서 규칙.
      const resolved = resolveRole(characterName, stats, itemPurchase, equipped);
      return {
        playerId: String(p?.playerId ?? ""),
        nickname: p?.nickname ?? null,
        characterId: String(info.characterId ?? ""),
        characterName,
        result: resultByPlayer.get(String(p?.playerId)) ?? info.result ?? "unknown",
        gameTypeId: detail.gameTypeId ?? null,
        killCount: Number(info.killCount ?? 0),
        deathCount: Number(info.deathCount ?? 0),
        assistCount: Number(info.assistCount ?? 0),
        items: equipped,
        itemPurchase,
        stats,
        role: resolved.role,
        roleSource: resolved.source,
      };
    })
    .filter((p) => p.playerId && p.characterId);

  const d = detail.date ? new Date(String(detail.date).replace(" ", "T")) : null;
  return {
    match: {
      matchId,
      gameTypeId: detail.gameTypeId ?? "unknown",
      mapId: detail.map?.mapId ?? null,
      mapName: detail.map?.name ?? null,
      playedAt: d && !Number.isNaN(d.getTime()) ? d : null,
    },
    players,
  };
}
