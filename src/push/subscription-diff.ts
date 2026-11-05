/**
 * subscription-diff.ts
 *
 * 앱이 보낸 "구독 목록 전체"와 DB 에 있는 기존 구독을 비교해, 실제로 바꿀 것만 골라내는 순수 함수.
 * 이미 있던 (kind, targetId) 는 행을 그대로 두고(lastEventAt 보존) 표시명만 바뀌었으면 고친다.
 * 빠진 것은 지우고, 새로 생긴 것만 넣는다.
 *
 * 데코레이터·외부 패키지를 쓰지 않는다 — 테스트 스크립트(node --experimental-strip-types)가 직접 불러온다.
 */

/** DB 에 이미 있는 구독 행(비교에 필요한 값만) */
export interface ExistingSubscription {
  /** 구독 행 ID */
  id: string;
  /** 구독 종류(player/live) */
  kind: string;
  /** 구독 대상 ID */
  targetId: string;
  /** 저장된 표시명 */
  label: string | null;
}

/** 앱이 원하는 구독 1건 */
export interface DesiredSubscription {
  /** 구독 종류(player/live) */
  kind: string;
  /** 구독 대상 ID */
  targetId: string;
  /** 표시명(닉네임/채널명). 빈 값이면 null */
  label: string | null;
}

/** 비교 결과 — 실제로 실행할 변경 목록 */
export interface SubscriptionDiff {
  /** 새로 넣을 구독 */
  toInsert: DesiredSubscription[];
  /** 지울 구독 행 ID */
  toDelete: string[];
  /** 표시명만 바꿀 구독(행 유지) */
  toRelabel: Array<{ id: string; label: string | null }>;
  /** 중복을 뺀 최종 구독 목록(응답 개수 계산용) */
  desired: DesiredSubscription[];
}

/**
 * (kind, targetId) 를 하나의 비교 키로 만든다.
 * @param kind — 구독 종류
 * @param targetId — 구독 대상 ID
 * @returns 비교 키
 */
export function subscriptionKey(kind: string, targetId: string): string {
  return `${kind}\u0000${targetId}`;
}

/**
 * 기존 구독과 원하는 구독 목록을 비교한다. 원하는 목록에 같은 대상이 여러 번 있으면 마지막 것을 쓴다.
 * @param existing — DB 에 있는 이 기기의 구독 행들
 * @param desired — 앱이 보낸 구독 목록(중복 가능)
 * @returns 넣을 것·지울 것·표시명만 바꿀 것
 */
export function diffSubscriptions(
  existing: readonly ExistingSubscription[],
  desired: readonly DesiredSubscription[],
): SubscriptionDiff {
  const want = new Map<string, DesiredSubscription>();
  for (const d of desired) want.set(subscriptionKey(d.kind, d.targetId), d);

  const have = new Set<string>();
  const toDelete: string[] = [];
  const toRelabel: Array<{ id: string; label: string | null }> = [];
  for (const e of existing) {
    const key = subscriptionKey(e.kind, e.targetId);
    have.add(key);
    const d = want.get(key);
    if (!d) toDelete.push(e.id);
    else if ((d.label ?? null) !== (e.label ?? null)) toRelabel.push({ id: e.id, label: d.label ?? null });
  }
  const toInsert = [...want.entries()].filter(([key]) => !have.has(key)).map(([, d]) => d);
  return { toInsert, toDelete, toRelabel, desired: [...want.values()] };
}
