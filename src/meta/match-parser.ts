/* Neople 매치 상세(raw) → matches / match_players 행으로 파싱 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ParsedPlayer {
  playerId: string;
  nickname: string | null;
  characterId: string;
  characterName: string | null;
  result: string;
  gameTypeId: string | null;
  killCount: number;
  deathCount: number;
  assistCount: number;
  items: unknown;
}
export interface ParsedMatch {
  match: {
    matchId: string;
    gameTypeId: string;
    mapId: string | null;
    mapName: string | null;
    playedAt: Date | null;
  };
  players: ParsedPlayer[];
}

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
      return {
        playerId: String(p?.playerId ?? ""),
        nickname: p?.nickname ?? null,
        characterId: String(info.characterId ?? ""),
        characterName: info.characterName ?? null,
        result: resultByPlayer.get(String(p?.playerId)) ?? info.result ?? "unknown",
        gameTypeId: detail.gameTypeId ?? null,
        killCount: Number(info.killCount ?? 0),
        deathCount: Number(info.deathCount ?? 0),
        assistCount: Number(info.assistCount ?? 0),
        items: Array.isArray(p?.items) ? p.items : null,
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
