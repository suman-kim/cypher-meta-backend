/**
 * push.service.ts
 *
 * 푸시 알림 기기·구독 데이터를 다루는 서비스.
 *  - 기기 등록(installId 기준 upsert, 같은 토큰을 쓰던 옛 기기 정리)
 *  - 구독 목록 동기화(전체 교체지만 차이만 반영 — lastEventAt 보존)
 *  - 기기 삭제(구독 포함), 무효 토큰 기기 정리, 오래 안 쓰인 기기 정리(보관 기간 90일)
 *  - 감지 작업이 쓰는 조회·갱신(구독 대상 목록, lastEventAt 저장 등)
 * 실제 발송은 PushDeliveryService 가 맡는다.
 */
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, In, LessThan, Not, Repository } from "typeorm";
import { PushDevice, PushSubscription } from "../database/entities";
import type { PushSubscriptionKind } from "../database/entities/push-subscription.entity";
import { liveKey } from "./alerts/alert-logic";
import { RegisterDeviceDto, SyncSubscriptionsDto } from "./dto";
import { DesiredSubscription, diffSubscriptions } from "./subscription-diff";

/** In(...) 한 번에 넣을 최대 값 수(DB 파라미터 한도 보호) */
const IN_CHUNK = 1000;

/**
 * 배열을 size 개씩 나눈다.
 * @param items — 나눌 배열
 * @param size — 한 묶음 크기
 * @returns 묶음 목록
 */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 기기·구독 데이터 서비스 */
@Injectable()
export class PushService {
  /** 로거 */
  private readonly logger = new Logger(PushService.name);

  /**
   * @param devices — push_devices 리포지토리
   * @param subscriptions — push_subscriptions 리포지토리
   * @param dataSource — 트랜잭션용 DataSource
   */
  constructor(
    @InjectRepository(PushDevice) private readonly devices: Repository<PushDevice>,
    @InjectRepository(PushSubscription) private readonly subscriptions: Repository<PushSubscription>,
    private readonly dataSource: DataSource,
  ) {}

  // ---------------------------------------------------------------- API

  /**
   * 기기를 등록하거나(처음) 토큰·플랫폼을 갱신한다(installId 기준 upsert).
   * 같은 토큰이 다른 installId 에 남아 있으면(앱 재설치 등) 그 옛 기기와 구독을 지운다 — 토큰은 유일해야 한다.
   * @param dto — installId·token·platform
   * @returns { ok: true }
   */
  async registerDevice(dto: RegisterDeviceDto): Promise<{ ok: true }> {
    const now = new Date();
    await this.dataSource.transaction(async (m) => {
      const stale = await m.find(PushDevice, {
        where: { token: dto.token, installId: Not(dto.installId) },
        select: { installId: true },
      });
      if (stale.length) {
        await this.deleteDevicesIn(m, stale.map((d) => d.installId));
        this.logger.log(`같은 토큰을 쓰던 옛 기기 ${stale.length}대 정리`);
      }
      await m.upsert(
        PushDevice,
        { installId: dto.installId, token: dto.token, platform: dto.platform, lastSeenAt: now, updatedAt: now },
        ["installId"],
      );
    });
    return { ok: true };
  }

  /**
   * 기기의 구독 목록을 앱이 보낸 목록으로 맞춘다. 전체 교체지만 차이만 반영한다:
   * 이미 있던 대상은 행을 유지(lastEventAt 보존, 표시명만 갱신), 빠진 것은 삭제, 새것은 추가.
   * @param dto — installId·players·lives
   * @returns { ok: true, players: 구독 중인 플레이어 수, lives: 구독 중인 채널 수 }
   * @throws NotFoundException 기기가 등록되어 있지 않을 때
   */
  async syncSubscriptions(dto: SyncSubscriptionsDto): Promise<{ ok: true; players: number; lives: number }> {
    const desired: DesiredSubscription[] = [
      ...dto.players.map((p) => ({ kind: "player", targetId: p.playerId, label: p.nickname.trim() || null })),
      ...dto.lives.map((l) => ({
        kind: "live",
        targetId: liveKey(l.platform, l.channelId),
        label: l.channelName.trim() || null,
      })),
    ];

    const diff = await this.dataSource.transaction(async (m) => {
      const device = await m.findOne(PushDevice, { where: { installId: dto.installId }, select: { installId: true } });
      if (!device) throw new NotFoundException("등록되지 않은 기기입니다");

      const existing = await m.find(PushSubscription, {
        where: { installId: dto.installId },
        select: { id: true, kind: true, targetId: true, label: true },
      });
      const d = diffSubscriptions(existing, desired);
      if (d.toDelete.length) await m.delete(PushSubscription, { id: In(d.toDelete) });
      for (const r of d.toRelabel) await m.update(PushSubscription, { id: r.id }, { label: r.label });
      if (d.toInsert.length) {
        await m
          .createQueryBuilder()
          .insert()
          .into(PushSubscription)
          .values(d.toInsert.map((s) => ({ installId: dto.installId, kind: s.kind, targetId: s.targetId, label: s.label })))
          .orIgnore() // 같은 기기에서 동시에 두 번 동기화해도 유일 키 충돌 없이 넘어간다
          .execute();
      }
      await m.update(PushDevice, { installId: dto.installId }, { lastSeenAt: new Date() });
      return d;
    });

    return {
      ok: true,
      players: diff.desired.filter((s) => s.kind === "player").length,
      lives: diff.desired.filter((s) => s.kind === "live").length,
    };
  }

  /**
   * 기기와 그 구독을 지운다. 없는 기기여도 성공으로 본다.
   * @param installId — 지울 기기의 설치 ID
   * @returns { ok: true }
   */
  async removeDevice(installId: string): Promise<{ ok: true }> {
    await this.dataSource.transaction((m) => this.deleteDevicesIn(m, [installId]));
    return { ok: true };
  }

  // ---------------------------------------------------------------- 발송·감지 작업용

  /**
   * 기기가 등록되어 있는지 확인한다.
   * @param installId — 설치 ID
   * @returns 등록되어 있으면 true
   */
  async deviceExists(installId: string): Promise<boolean> {
    return (await this.devices.count({ where: { installId } })) > 0;
  }

  /**
   * 설치 ID 목록에 해당하는 기기의 토큰을 가져온다.
   * @param installIds — 설치 ID 목록
   * @returns 기기별 installId·token
   */
  async findDeviceTokens(installIds: string[]): Promise<Array<{ installId: string; token: string }>> {
    const out: Array<{ installId: string; token: string }> = [];
    for (const ids of chunk(installIds, IN_CHUNK)) {
      out.push(...(await this.devices.find({ where: { installId: In(ids) }, select: { installId: true, token: true } })));
    }
    return out;
  }

  /**
   * 더는 쓸 수 없는 토큰의 기기(와 구독)를 지운다.
   * @param tokens — 무효 토큰 목록
   * @returns 지운 기기 수
   */
  async removeDevicesByTokens(tokens: string[]): Promise<number> {
    let removed = 0;
    for (const part of chunk(tokens, IN_CHUNK)) {
      removed += await this.dataSource.transaction(async (m) => {
        const rows = await m.find(PushDevice, { where: { token: In(part) }, select: { installId: true } });
        await this.deleteDevicesIn(m, rows.map((r) => r.installId));
        return rows.length;
      });
    }
    return removed;
  }

  /**
   * 한 종류의 구독 행을 모두 가져온다(전적 감지용 — 판단에 필요한 컬럼만).
   * @param kind — 구독 종류
   * @returns 구독 행 목록(id·installId·targetId·label·lastEventAt)
   */
  listSubscriptions(kind: PushSubscriptionKind): Promise<PushSubscription[]> {
    return this.subscriptions.find({
      where: { kind },
      select: { id: true, installId: true, targetId: true, label: true, lastEventAt: true },
    });
  }

  /**
   * 특정 대상들을 구독한 행을 가져온다.
   * @param kind — 구독 종류
   * @param targetIds — 대상 ID 목록
   * @returns 구독 행 목록
   */
  findSubscriptions(kind: PushSubscriptionKind, targetIds: string[]): Promise<PushSubscription[]> {
    if (!targetIds.length) return Promise.resolve([]);
    return this.subscriptions.find({
      where: { kind, targetId: In(targetIds) },
      select: { id: true, installId: true, targetId: true, label: true },
    });
  }

  /**
   * 한 종류에서 구독자가 한 명이라도 있는 대상 ID 목록(중복 제거)을 가져온다.
   * @param kind — 구독 종류
   * @returns 대상 ID 목록
   */
  async listTargetIds(kind: PushSubscriptionKind): Promise<string[]> {
    const rows = await this.subscriptions
      .createQueryBuilder("s")
      .select("DISTINCT s.targetId", "targetId")
      .where("s.kind = :kind", { kind })
      .getRawMany<{ targetId: string }>();
    return rows.map((r) => r.targetId);
  }

  /**
   * 구독 행들의 lastEventAt(마지막으로 반영한 경기 시각)을 저장한다.
   * @param ids — 구독 행 ID 목록
   * @param at — 저장할 시각
   */
  async setLastEventAt(ids: string[], at: Date): Promise<void> {
    for (const part of chunk(ids, IN_CHUNK)) await this.subscriptions.update({ id: In(part) }, { lastEventAt: at });
  }

  /**
   * 마지막 사용(lastSeenAt)이 기준 시각보다 이른 기기와 그 구독을 지운다(보관 기간 정리).
   * 한 번에 IN_CHUNK 대씩 나눠 지워 긴 트랜잭션을 피한다.
   * @param cutoff — 이 시각보다 lastSeenAt 이 이르면 삭제
   * @returns 지운 기기 수
   */
  async removeStaleDevices(cutoff: Date): Promise<number> {
    let removed = 0;
    for (;;) {
      const rows = await this.devices.find({
        where: { lastSeenAt: LessThan(cutoff) },
        select: { installId: true },
        take: IN_CHUNK,
      });
      if (!rows.length) break;
      await this.dataSource.transaction((m) => this.deleteDevicesIn(m, rows.map((r) => r.installId)));
      removed += rows.length;
      if (rows.length < IN_CHUNK) break;
    }
    return removed;
  }

  // ---------------------------------------------------------------- 내부

  /**
   * 트랜잭션 안에서 기기들과 그 구독을 지운다. (외래키 CASCADE 가 있어도, 외래키가 없는 DB 를 대비해 구독을 먼저 지운다)
   * @param m — 트랜잭션 EntityManager
   * @param installIds — 지울 설치 ID 목록
   */
  private async deleteDevicesIn(m: EntityManager, installIds: string[]): Promise<void> {
    if (!installIds.length) return;
    await m.delete(PushSubscription, { installId: In(installIds) });
    await m.delete(PushDevice, { installId: In(installIds) });
  }
}
