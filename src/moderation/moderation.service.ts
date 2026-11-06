/**
 * moderation.service.ts — 사용자 신고 접수·관리자 처리.
 *
 *  - 신고 접수: 대상이 있는지 확인(ReportTarget.snapshot) → 같은 사람의 중복·과다 신고를 거른 뒤 사본과 함께 저장.
 *  - 관리자 목록: 대기 중 / 처리됨 신고를 대상별로 묶어(groupReports) 페이지로 나눈다.
 *  - 관리자 처리: 대상 삭제 또는 문제없음으로 그 대상의 대기 신고를 한꺼번에 닫고,
 *    원하면 작성자 닉네임을 금칙어에 넣어 그 닉네임으로 더 쓰지 못하게 한다(정책의 '사용자 조치').
 *  - 정리: 처리한 지 1년(REPORT_RETENTION_DAYS)이 지난 기록을 하루 한 번 지운다(개인정보처리방침 보유 기간).
 *    대기 중인 신고는 처리될 때까지 지우지 않는다. 라이브러리 없이 setTimeout 으로 돈다(다른 스케줄러와 같은 방식).
 * 대상 종류별 차이는 ReportTargetRegistry(전략 패턴)가 맡는다.
 */
import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, LessThan, MoreThan, Repository } from "typeorm";
import { ContentReport } from "../database/entities";
import { BannedWordService } from "../community/banned-word.service";
import type { AdminReportsQuery, CreateReportDto, ResolveReportDto } from "./dto";
import {
  clipText,
  groupReports,
  hashReporterKey,
  MAX_REPORTS_PER_DAY,
  retentionCutoff,
  statusForAction,
  type ReportGroup,
} from "./report-logic";
import { ReportTargetRegistry } from "./report-targets";

/** 처리됨 보기에서 읽어 올 최근 신고 행 수 상한(오래된 처리 기록까지 다 읽지 않게) */
const HANDLED_ROW_LIMIT = 1000;
/** 하루(밀리초) */
const DAY_MS = 24 * 60 * 60 * 1000;
/** 부팅 뒤 첫 정리까지 기다리는 시간(밀리초) — 부팅 직후 DB 부하를 피한다 */
const FIRST_PURGE_DELAY_MS = 5 * 60 * 1000;

/** 신고 접수 결과 */
export interface ReportResult {
  /** 접수 성공 여부(중복이어도 true — 사용자에게는 이미 접수된 것) */
  ok: true;
  /** 이미 같은 대상을 신고한 적이 있어 새로 저장하지 않았는지 */
  duplicate: boolean;
}

/** 관리자 목록 결과 */
export interface ReportPage {
  /** 대상별 신고 묶음(이 페이지 분량) */
  groups: ReportGroup[];
  /** 전체 묶음 수 */
  total: number;
  /** 현재 페이지 */
  page: number;
  /** 페이지당 묶음 수 */
  pageSize: number;
  /** 대기 중인 대상 수(관리자 탭 배지용) */
  pendingTargets: number;
}

/** 관리자 처리 결과 */
export interface ResolveResult {
  /** 처리 성공 여부 */
  ok: true;
  /** 상태를 바꾼 신고 행 수 */
  updated: number;
  /** 대상을 실제로 지웠는지(이미 지워졌으면 false, 문제없음 처리면 false) */
  removed: boolean;
  /** 금칙어 등록 결과(요청하지 않았거나 닉네임이 없으면 null) */
  banned: { word: string; added: boolean } | null;
}

/** 신고 서비스 */
@Injectable()
export class ModerationService implements OnApplicationBootstrap, OnModuleDestroy {
  /** 로거 */
  private readonly logger = new Logger(ModerationService.name);
  /** 다음 정리 타이머 */
  private purgeTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param reports — 신고 리포지토리 (DI 주입)
   * @param targets — 대상 종류별 처리 등록부 (DI 주입)
   * @param banned — 금칙어 서비스(닉네임 작성 제한) (DI 주입)
   */
  constructor(
    @InjectRepository(ContentReport) private readonly reports: Repository<ContentReport>,
    private readonly targets: ReportTargetRegistry,
    private readonly banned: BannedWordService,
  ) {}

  /** 부팅이 끝나면 정리 작업을 예약한다 */
  onApplicationBootstrap(): void {
    this.schedulePurge(FIRST_PURGE_DELAY_MS);
  }

  /** 종료할 때 예약을 지운다 */
  onModuleDestroy(): void {
    if (this.purgeTimer) clearTimeout(this.purgeTimer);
    this.purgeTimer = null;
  }

  /**
   * 정리 작업을 예약한다(끝나면 하루 뒤 다시).
   * @param delayMs — 기다릴 시간(밀리초)
   */
  private schedulePurge(delayMs: number): void {
    this.purgeTimer = setTimeout(() => {
      void this.purgeOld()
        .catch((e) => this.logger.warn(`신고 기록 정리 실패: ${(e as Error).message}`))
        .finally(() => this.schedulePurge(DAY_MS));
    }, delayMs);
    this.purgeTimer.unref?.();
  }

  /**
   * 처리한 지 보관 기간이 지난 신고 기록을 지운다(대기 중인 신고는 남긴다).
   * @param now — 기준 시각(기본 지금)
   * @returns 지운 행 수
   */
  async purgeOld(now: Date = new Date()): Promise<number> {
    const r = await this.reports.delete({
      status: In(["deleted", "dismissed"]),
      handledAt: LessThan(retentionCutoff(now)),
    });
    const n = r.affected ?? 0;
    if (n > 0) this.logger.log(`보관 기간이 지난 신고 기록 ${n}건을 지웠습니다.`);
    return n;
  }

  /**
   * 신고를 접수한다.
   * @param dto — 대상·사유·상세·신고자 임의 ID
   * @returns 접수 결과(중복이면 duplicate=true)
   * @throws NotFoundException — 대상이 없거나 신고할 수 없는 대상(공지 등)
   * @throws HttpException(429) — 24시간 신고 한도 초과
   */
  async report(dto: CreateReportDto): Promise<ReportResult> {
    const snap = await this.targets.get(dto.targetType).snapshot(dto.targetId);
    if (!snap) throw new NotFoundException("신고할 글을 찾을 수 없어요. 이미 지워졌을 수 있어요.");

    const reporterHash = hashReporterKey(dto.reporterKey);
    const already = await this.reports.findOne({
      where: { targetType: dto.targetType, targetId: dto.targetId, reporterHash },
      select: ["id"],
    });
    if (already) return { ok: true, duplicate: true };

    const recent = await this.reports.count({
      where: { reporterHash, createdAt: MoreThan(new Date(Date.now() - DAY_MS)) },
    });
    if (recent >= MAX_REPORTS_PER_DAY) {
      throw new HttpException("오늘은 신고를 더 할 수 없어요. 내일 다시 시도해 주세요.", HttpStatus.TOO_MANY_REQUESTS);
    }

    const detail = dto.detail?.trim();
    try {
      await this.reports.insert({
        targetType: dto.targetType,
        targetId: dto.targetId,
        reason: dto.reason,
        detail: detail ? clipText(detail, 500) : null,
        reporterHash,
        status: "pending",
        snapshotTitle: snap.title,
        snapshotContent: snap.content,
        snapshotAuthor: snap.authorName ? clipText(snap.authorName, 40) : null,
        targetLink: snap.link,
      });
    } catch (e) {
      // 동시에 두 번 눌러 유일 인덱스에 걸린 경우 — 이미 접수된 것으로 본다
      if ((e as { code?: string }).code === "23505") return { ok: true, duplicate: true };
      throw e;
    }
    this.logger.log(`신고 접수: ${dto.targetType} ${dto.targetId} (${dto.reason})`);
    return { ok: true, duplicate: false };
  }

  /**
   * 관리자 신고 목록(대상별 묶음).
   * @param q — 보기(pending/handled)·페이지·페이지 크기
   * @returns 묶음 페이지와 대기 대상 수
   */
  async adminList(q: AdminReportsQuery): Promise<ReportPage> {
    const view = q.view ?? "pending";
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;

    const pendingRows = await this.reports.find({ where: { status: "pending" }, order: { createdAt: "DESC" } });
    const pendingGroups = groupReports(pendingRows);

    let groups: ReportGroup[];
    if (view === "pending") {
      groups = pendingGroups;
    } else {
      const handledRows = await this.reports.find({
        where: { status: In(["deleted", "dismissed"]) },
        order: { handledAt: "DESC" },
        take: HANDLED_ROW_LIMIT,
      });
      // 처리됨 보기는 최근에 처리한 것부터
      groups = groupReports(handledRows).sort(
        (a, b) => (b.handledAt?.getTime() ?? 0) - (a.handledAt?.getTime() ?? 0),
      );
    }

    return {
      groups: groups.slice((page - 1) * pageSize, page * pageSize),
      total: groups.length,
      page,
      pageSize,
      pendingTargets: pendingGroups.length,
    };
  }

  /**
   * 대상 하나의 대기 신고를 처리한다(삭제 또는 문제없음).
   * @param dto — 대상·처리 방법·닉네임 작성 제한 여부
   * @returns 처리 결과
   */
  async resolve(dto: ResolveReportDto): Promise<ResolveResult> {
    const target = this.targets.get(dto.targetType);
    const removed = dto.action === "delete" ? await target.remove(dto.targetId) : false;

    const result = await this.reports.update(
      { targetType: dto.targetType, targetId: dto.targetId, status: "pending" },
      { status: statusForAction(dto.action), handledAt: new Date() },
    );

    let banned: ResolveResult["banned"] = null;
    if (dto.banAuthor) {
      const latest = await this.reports.findOne({
        where: { targetType: dto.targetType, targetId: dto.targetId },
        order: { createdAt: "DESC" },
        select: ["id", "snapshotAuthor"],
      });
      const word = latest?.snapshotAuthor?.trim();
      if (word) {
        const r = await this.banned.add([word]);
        banned = { word, added: r.added.length > 0 };
      }
    }

    this.logger.log(
      `신고 처리: ${dto.targetType} ${dto.targetId} → ${dto.action}${removed ? "(삭제됨)" : ""}${banned ? `, 닉네임 제한 ${banned.word}` : ""}`,
    );
    return { ok: true, updated: result.affected ?? 0, removed, banned };
  }
}
