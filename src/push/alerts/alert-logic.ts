/**
 * alert-logic.ts
 *
 * 알림 감지 작업(방송 시작 / 전적 갱신)에서 쓰는 판단 로직과 알림 문구 만들기를 모은 순수 함수 파일.
 * DB·네트워크·Nest 에 의존하지 않으므로 테스트 스크립트(test/push-logic.test.ts)로 바로 검증할 수 있다.
 * (node --experimental-strip-types 로 직접 불러오므로 다른 파일에서는 `import type` 만 가져온다.)
 */
import type { PushMessage } from "../push-message";

// ------------------------------------------------------------------ 공통

/** 같은 경기를 '새 경기'로 볼 수 있는 최대 경과 시간(6시간) — 너무 오래된 경기는 알리지 않는다 */
export const MATCH_FRESH_WINDOW_MS = 6 * 60 * 60 * 1000;

/** 같은 채널의 방송 시작 알림을 다시 보내지 않는 시간(30분) — 방송이 잠깐 끊겼다 다시 켜질 때 대비 */
export const LIVE_COOLDOWN_MS = 30 * 60 * 1000;

/**
 * 작업 목록을 동시에 최대 limit 개씩만 돌린다(외부 API 부하 제한).
 * @param items — 처리할 항목들
 * @param limit — 동시에 돌릴 최대 개수(1 이상)
 * @param fn — 항목 하나를 처리하는 비동기 함수(항목, 순번)
 * @returns 입력 순서대로 정렬된 결과 목록
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  };
  const n = Math.max(1, Math.min(Math.trunc(limit) || 1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

// ------------------------------------------------------------------ 방송 시작

/**
 * 라이브 구독 대상 키를 만든다. push_subscriptions.targetId(kind=live) 와 같은 형식이다.
 * @param platform — 방송 플랫폼(chzzk | youtube | soop)
 * @param channelId — 플랫폼의 채널 ID
 * @returns "플랫폼:채널ID"
 */
export function liveKey(platform: string, channelId: string): string {
  return `${platform}:${channelId}`;
}

/**
 * 라이브 키에서 플랫폼 부분을 꺼낸다.
 * @param key — "플랫폼:채널ID"
 * @returns 플랫폼(콜론이 없으면 키 전체)
 */
export function platformOfLiveKey(key: string): string {
  const i = key.indexOf(":");
  return i < 0 ? key : key.slice(0, i);
}

/** 플랫폼별 '지금 방송 중인 라이브 키' 집합 — 직전 틱 상태를 기억하는 데 쓴다 */
export type LiveSnapshot = Map<string, Set<string>>;

/** 방송 시작 판단 결과 */
export interface LiveTransition {
  /** 이번 틱에 새로 나타난 라이브 키(= 방송 시작) */
  started: string[];
  /** 다음 틱에 비교할 스냅샷 */
  next: LiveSnapshot;
}

/**
 * 직전 상태와 이번 조회 결과를 비교해 '새로 방송을 켠' 채널을 찾는다.
 *  - 직전 상태에 그 플랫폼이 없으면(첫 조회) 기준점만 잡고 알리지 않는다.
 *  - 조회에 실패한 플랫폼(값 null)은 직전 상태를 그대로 유지한다(복구 순간 전부 '새 방송'으로 보이지 않게).
 *  - fetched 에 아예 없는 플랫폼(구독자가 없어 조회하지 않음)은 다음 상태에서 뺀다 → 다시 조회하면 기준점부터.
 * @param prev — 직전 스냅샷(플랫폼 → 라이브 키 집합)
 * @param fetched — 이번에 조회한 플랫폼별 라이브 키 집합. null 은 조회 실패
 * @returns 새로 시작한 라이브 키와 다음 스냅샷
 */
export function computeLiveTransition(
  prev: ReadonlyMap<string, ReadonlySet<string>>,
  fetched: ReadonlyMap<string, ReadonlySet<string> | null>,
): LiveTransition {
  const next: LiveSnapshot = new Map();
  const started: string[] = [];
  for (const [platform, current] of fetched) {
    const before = prev.get(platform);
    if (current === null) {
      if (before) next.set(platform, new Set(before)); // 실패 → 직전 값 유지
      continue;
    }
    if (before) for (const key of current) if (!before.has(key)) started.push(key);
    next.set(platform, new Set(current));
  }
  return { started, next };
}

/**
 * 쿨다운 중인 키를 뺀다(최근 cooldownMs 안에 이미 알린 채널).
 * @param keys — 후보 라이브 키
 * @param lastSentAt — 키별 마지막 발송 시각(ms)
 * @param now — 현재 시각(ms)
 * @param cooldownMs — 다시 알리지 않는 시간(ms)
 * @returns 지금 알려도 되는 키
 */
export function filterCooldown(
  keys: readonly string[],
  lastSentAt: ReadonlyMap<string, number>,
  now: number,
  cooldownMs: number,
): string[] {
  return keys.filter((k) => {
    const last = lastSentAt.get(k);
    return last === undefined || now - last >= cooldownMs;
  });
}

/**
 * 쿨다운이 끝난 기록을 지워 메모리가 계속 늘지 않게 한다(맵을 직접 수정).
 * @param lastSentAt — 키별 마지막 발송 시각(ms)
 * @param now — 현재 시각(ms)
 * @param cooldownMs — 쿨다운 시간(ms)
 */
export function pruneCooldown(lastSentAt: Map<string, number>, now: number, cooldownMs: number): void {
  for (const [k, t] of lastSentAt) if (now - t >= cooldownMs) lastSentAt.delete(k);
}

/** 방송 시작 알림에 필요한 라이브 정보 */
export interface LiveInfo {
  /** 채널 이름 */
  channelName: string;
  /** 방송 제목 */
  title: string;
  /** 방송을 여는 주소(https) */
  url: string;
}

/**
 * 방송 시작 알림 문구를 만든다.
 * title "{채널명} 방송 시작", body = 방송 제목(없으면 "지금 사이퍼즈 방송 중"), url = 방송 주소.
 * @param live — 라이브 정보
 * @param fallbackName — 채널명이 비었을 때 쓸 이름(구독 때 저장한 표시명)
 * @returns 보낼 알림
 */
export function buildLiveMessage(live: LiveInfo, fallbackName?: string | null): PushMessage {
  const name = live.channelName.trim() || (fallbackName ?? "").trim() || "구독한 채널";
  return {
    kind: "live",
    title: `${name} 방송 시작`,
    body: live.title.trim() || "지금 사이퍼즈 방송 중",
    url: live.url,
  };
}

// ------------------------------------------------------------------ 전적 갱신

/** 게임 종류 — rating(공식전) / normal(일반전) */
export type GameType = "rating" | "normal";

/** 알림 판단에 쓰는 경기 1건 요약(Neople 매치 목록 1행에서 뽑음) */
export interface MatchSummary {
  /** 매치 ID */
  matchId: string;
  /** 게임 종류 */
  gameType: GameType;
  /** 경기 시각 */
  playedAt: Date;
  /** 결과("win" | "lose" 등, 없으면 null) */
  result: string | null;
  /** 사용 캐릭터 이름(없으면 null) */
  characterName: string | null;
  /** 킬 */
  kill: number;
  /** 데스 */
  death: number;
  /** 어시스트 */
  assist: number;
}

/** 구독 1건에 대한 전적 알림 판단 결과 */
export interface MatchDecision {
  /** true 면 이번이 첫 점검 — 기준점만 잡고 알리지 않음 */
  baseline: boolean;
  /** 알릴 새 경기(최신순). 비어 있으면 알리지 않음 */
  newMatches: MatchSummary[];
  /** 새로 저장할 lastEventAt. null 이면 바꾸지 않음 */
  nextLastEventAt: Date | null;
}

/**
 * 구독 1건(lastEventAt)과 최근 경기 목록으로 알릴 경기와 다음 기준 시각을 정한다.
 *  - lastEventAt 이 null → 기준점: 가장 최근 경기 시각(경기가 없으면 now)으로 채우고 알리지 않는다.
 *  - 그 외 → lastEventAt 보다 뒤이고 최근 windowMs(기본 6시간) 안의 경기만 새 경기로 본다.
 *    lastEventAt 은 받아 온 경기 중 가장 최신 시각으로 올린다(6시간이 지난 경기도 다시 보지 않게).
 * @param lastEventAt — 이 구독에 마지막으로 반영한 경기 시각(null = 기준점 없음)
 * @param matches — 최근 경기 목록(공식전·일반전 합침, 순서 무관)
 * @param now — 현재 시각
 * @param windowMs — 새 경기로 인정할 최대 경과 시간(ms)
 * @returns 판단 결과
 */
export function decideMatchAlert(
  lastEventAt: Date | null,
  matches: readonly MatchSummary[],
  now: Date,
  windowMs: number = MATCH_FRESH_WINDOW_MS,
): MatchDecision {
  const unique = new Map<string, MatchSummary>();
  for (const m of matches) if (!Number.isNaN(m.playedAt.getTime())) unique.set(m.matchId, m);
  const sorted = [...unique.values()].sort((a, b) => b.playedAt.getTime() - a.playedAt.getTime());
  const latest = sorted[0]?.playedAt ?? null;

  if (lastEventAt === null) {
    return { baseline: true, newMatches: [], nextLastEventAt: latest ?? now };
  }
  const since = lastEventAt.getTime();
  const newMatches = sorted.filter(
    (m) => m.playedAt.getTime() > since && now.getTime() - m.playedAt.getTime() <= windowMs,
  );
  const nextLastEventAt = latest && latest.getTime() > since ? latest : null;
  return { baseline: false, newMatches, nextLastEventAt };
}

/**
 * 게임 종류를 화면에 보일 이름으로 바꾼다.
 * @param gameType — rating | normal
 * @returns "공식전" | "일반전"
 */
export function gameTypeLabel(gameType: GameType): string {
  return gameType === "rating" ? "공식전" : "일반전";
}

/**
 * 경기 결과를 화면에 보일 이름으로 바꾼다.
 * @param result — Neople 결과 값("win" | "lose" …)
 * @returns "승리" | "패배" | "경기 종료"
 */
export function resultLabel(result: string | null): string {
  if (result === "win") return "승리";
  if (result === "lose") return "패배";
  return "경기 종료";
}

/**
 * 전적 갱신 알림 문구를 만든다.
 *  - 1판  : title "{닉네임} 새 {공식전|일반전} 기록", body "{승리|패배} · {캐릭터} · {K}/{D}/{A}",
 *           url "/matches/{matchId}?highlight={playerId}"
 *  - 여러 판: title "{닉네임} 새 경기 {n}판", body "{w}승 {l}패 · 최근 {캐릭터}", url "/players/{playerId}"
 * @param nickname — 플레이어 닉네임(Neople 응답 우선, 없으면 구독 표시명)
 * @param playerId — Neople playerId
 * @param newMatches — 알릴 새 경기(최신순, 1건 이상)
 * @returns 보낼 알림
 */
export function buildMatchMessage(
  nickname: string | null,
  playerId: string,
  newMatches: readonly MatchSummary[],
): PushMessage {
  const name = (nickname ?? "").trim() || "구독한 플레이어";
  const latest = newMatches[0];
  const character = latest?.characterName?.trim() || "알 수 없는 캐릭터";
  if (newMatches.length === 1) {
    return {
      kind: "match",
      title: `${name} 새 ${gameTypeLabel(latest.gameType)} 기록`,
      body: `${resultLabel(latest.result)} · ${character} · ${latest.kill}/${latest.death}/${latest.assist}`,
      url: `/matches/${encodeURIComponent(latest.matchId)}?highlight=${encodeURIComponent(playerId)}`,
    };
  }
  const wins = newMatches.filter((m) => m.result === "win").length;
  const losses = newMatches.filter((m) => m.result === "lose").length;
  return {
    kind: "match",
    title: `${name} 새 경기 ${newMatches.length}판`,
    body: `${wins}승 ${losses}패 · 최근 ${character}`,
    url: `/players/${encodeURIComponent(playerId)}`,
  };
}
