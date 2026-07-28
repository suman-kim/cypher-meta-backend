/**
 * necklace.service.ts
 * ---------------------------------------------------------------------------
 * 목걸이(목 슬롯 107) 아이템의 공/방 성향 판별 서비스.
 *
 * 사이퍼즈에서 착용 목걸이는 그 판의 운용 방향(공격형/방어형)을 플레이어가 직접
 * 선택한 것이라, 포지션 판별(3차 아이템 규칙)의 1순위 신호로 쓴다.
 * 판별은 아이템 상세(/battleitems/{id})의 스탯 텍스트(explainDetail)에서
 * 공격 키워드(공격력·치명)와 방어 키워드(방어력·체력) 출현 수를 비교해 결정한다.
 *
 * 비용: 목걸이 "종류당" 1회 조회 — 매치당이 아니다. 전체 수십 종 수준이고
 * 프로세스 메모리 캐시 + api_cache(6h TTL)로 사실상 추가 비용이 없다.
 */
import { Injectable, Logger } from "@nestjs/common";
import { NeopleService } from "../neople/neople.service";
import type { NeckType } from "./role-resolver";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type { NeckType };

@Injectable()
export class NecklaceService {
  private readonly logger = new Logger(NecklaceService.name);
  /** itemId → 판별 결과 캐시(null=텍스트로 판별 불가). 실패(예외)는 캐시하지 않는다. */
  private readonly cache = new Map<string, NeckType | null>();

  constructor(private readonly neople: NeopleService) {}

  /**
   * 목걸이 아이템의 공/방 성향을 판별한다(결과 캐시).
   * @returns "atk"(공목걸이) | "def"(방목걸이) | null(판별 불가/조회 실패)
   */
  async classify(itemId: string): Promise<NeckType | null> {
    if (this.cache.has(itemId)) return this.cache.get(itemId) ?? null;
    try {
      const detail: any = await this.neople.proxy(`/battleitems/${encodeURIComponent(itemId)}`);
      const text = [detail?.explain, detail?.explainDetail].filter(Boolean).join(" ");
      const atkScore = (text.match(/공격력|치명/g) ?? []).length;
      const defScore = (text.match(/방어력|체력/g) ?? []).length;
      const type: NeckType | null = atkScore > defScore ? "atk" : defScore > atkScore ? "def" : null;
      this.cache.set(itemId, type);
      this.logger.log(
        `목걸이 판별: ${detail?.itemName ?? itemId} → ${type ?? "불명"} (공${atkScore}/방${defScore})`,
      );
      return type;
    } catch {
      // 조회 실패는 캐시하지 않음 — 다음 수집에서 재시도된다.
      return null;
    }
  }
}
