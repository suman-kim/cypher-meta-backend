/**
 * costumes.service.ts
 * ------------------------------------------------------------------
 * 코스튬 카탈로그 + 피드백(시세 신고 / 수정 요청) 비즈니스 로직.
 *  - list/facets/importRows/remove : 코스튬 카탈로그
 *  - listFeedback/createFeedback/deleteFeedback/resolveFeedback : 코스튬별 피드백
 * 실제 이미지 파일 저장은 프론트(public 폴더)에서 처리하고, 여기선 메타데이터만 다룬다.
 * ------------------------------------------------------------------
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Costume, CostumeFeedback } from "../database/entities";
import { CostumeRowDto, CreateFeedbackDto } from "./dto";
import { hashPassword, verifyPassword } from "../community/password.util";

/** 조회 시 클라이언트로 내보내는 피드백 형태(비밀번호 해시는 제외, 존재 여부만 노출) */
export interface FeedbackView {
  id: number;
  kind: string;
  price: number | null;
  priceUnit: string;
  field: string;
  content: string;
  authorName: string | null;
  status: string;
  createdAt: Date;
  hasPassword: boolean;
}

/** 코스튬 조회·가져오기·삭제 + 피드백을 담당하는 서비스. */
@Injectable()
export class CostumesService {
  /**
   * @param repo — 코스튬(Costume) 리포지토리
   * @param fbRepo — 코스튬 피드백(CostumeFeedback) 리포지토리
   */
  constructor(
    @InjectRepository(Costume) private readonly repo: Repository<Costume>,
    @InjectRepository(CostumeFeedback) private readonly fbRepo: Repository<CostumeFeedback>,
  ) {}

  /* ---------------- 카탈로그 ---------------- */

  /**
   * 코스튬 목록 조회. 캐릭터명/연도로 필터할 수 있다.
   * @returns 연도 내림차순 → 캐릭터명 → 세트 순서(seq) → id 로 정렬된 코스튬 배열
   */
  async list(opts: { character?: string; year?: number }): Promise<Costume[]> {
    const qb = this.repo.createQueryBuilder("c");
    if (opts.character) qb.andWhere("c.characterName = :ch", { ch: opts.character });
    if (typeof opts.year === "number" && Number.isFinite(opts.year))
      qb.andWhere("c.releaseYear = :yr", { yr: opts.year });
    qb.orderBy("c.releaseYear", "DESC")
      .addOrderBy("c.characterName", "ASC")
      .addOrderBy("c.seq", "ASC")
      .addOrderBy("c.id", "ASC");
    return qb.getMany();
  }

  /** 필터 UI 용 패싯(캐릭터/연도 목록 + 개수)과 총 개수. */
  async facets(): Promise<{
    total: number;
    characters: { name: string; count: number }[];
    years: { year: number; count: number }[];
  }> {
    const rows = await this.repo.find({ select: ["characterName", "releaseYear"] });
    const chars = new Map<string, number>();
    const years = new Map<number, number>();
    for (const r of rows) {
      chars.set(r.characterName, (chars.get(r.characterName) ?? 0) + 1);
      years.set(r.releaseYear, (years.get(r.releaseYear) ?? 0) + 1);
    }
    return {
      total: rows.length,
      characters: [...chars.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => a.name.localeCompare(b.name, "ko")),
      years: [...years.entries()]
        .map(([year, count]) => ({ year, count }))
        .sort((a, b) => b.year - a.year),
    };
  }

  /**
   * 코스튬 행 일괄 가져오기(upsert 또는 세트 replace).
   * @returns { ok, mode, inserted, updated, total }
   */
  async importRows(
    rows: CostumeRowDto[],
    mode: "upsert" | "replace" = "upsert",
  ): Promise<{ ok: boolean; mode: string; inserted: number; updated: number; total: number }> {
    let inserted = 0;
    let updated = 0;

    if (mode === "replace") {
      const sets = new Map<string, { character: string; year: number }>();
      for (const r of rows)
        sets.set(`${r.characterName}__${r.releaseYear}`, {
          character: r.characterName,
          year: r.releaseYear,
        });
      for (const s of sets.values())
        await this.repo.delete({ characterName: s.character, releaseYear: s.year });
    }

    for (const r of rows) {
      const existing =
        mode === "replace"
          ? null
          : await this.repo.findOne({
              where: {
                characterName: r.characterName,
                releaseYear: r.releaseYear,
                costumeName: r.costumeName,
              },
            });

      if (existing) {
        existing.imagePath = r.imagePath;
        existing.imageFile = r.imageFile ?? existing.imageFile;
        existing.seq = typeof r.seq === "number" ? r.seq : existing.seq;
        await this.repo.save(existing);
        updated++;
      } else {
        await this.repo.save(
          this.repo.create({
            characterName: r.characterName,
            releaseYear: r.releaseYear,
            costumeName: r.costumeName,
            imagePath: r.imagePath,
            imageFile: r.imageFile ?? "",
            seq: typeof r.seq === "number" ? r.seq : 0,
          }),
        );
        inserted++;
      }
    }

    const total = await this.repo.count();
    return { ok: true, mode, inserted, updated, total };
  }

  /** 코스튬 1건 삭제. */
  async remove(id: number): Promise<{ ok: boolean; deleted: number }> {
    if (!Number.isFinite(id)) return { ok: false, deleted: 0 };
    const res = await this.repo.delete({ id });
    return { ok: true, deleted: res.affected ?? 0 };
  }

  /* ---------------- 피드백(시세/수정요청) ---------------- */

  private toView(r: CostumeFeedback): FeedbackView {
    return {
      id: r.id,
      kind: r.kind,
      price: r.price != null ? Number(r.price) : null,
      priceUnit: r.priceUnit,
      field: r.field,
      content: r.content,
      authorName: r.authorName,
      status: r.status,
      createdAt: r.createdAt,
      hasPassword: !!r.guestPassword,
    };
  }

  /**
   * 특정 코스튬의 피드백 조회 — 시세/수정요청 분리 + 시세 요약.
   * @param costumeId — 코스튬 id
   * @returns { prices, corrections, priceSummary }
   */
  async listFeedback(costumeId: number): Promise<{
    prices: FeedbackView[];
    corrections: FeedbackView[];
    priceSummary: {
      count: number;
      average: number | null;
      min: number | null;
      max: number | null;
      unit: string;
    };
  }> {
    if (!Number.isFinite(costumeId))
      return {
        prices: [],
        corrections: [],
        priceSummary: { count: 0, average: null, min: null, max: null, unit: "" },
      };
    // guestPassword 는 select:false → 존재 여부(hasPassword)만 쓰려고 addSelect
    const rows = await this.fbRepo
      .createQueryBuilder("f")
      .addSelect("f.guestPassword")
      .where("f.costumeId = :cid", { cid: costumeId })
      .orderBy("f.createdAt", "DESC")
      .addOrderBy("f.id", "DESC")
      .getMany();

    const prices = rows.filter((r) => r.kind === "price").map((r) => this.toView(r));
    const corrections = rows.filter((r) => r.kind === "correction").map((r) => this.toView(r));

    // 현재 시세 = 등록된 시세들의 평균(반올림). 단위는 다수 값(보통 주괴).
    const vals = prices
      .map((p) => p.price)
      .filter((n): n is number => typeof n === "number" && n > 0);
    const average = vals.length
      ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
      : null;
    const unit = prices.find((p) => p.priceUnit)?.priceUnit ?? "";
    return {
      prices,
      corrections,
      priceSummary: {
        count: vals.length,
        average,
        min: vals.length ? Math.min(...vals) : null,
        max: vals.length ? Math.max(...vals) : null,
        unit,
      },
    };
  }

  /**
   * 피드백 작성(시세 신고 / 수정 요청).
   * @param costumeId — 대상 코스튬 id (존재하지 않으면 404)
   * @param dto — 작성 내용
   * @returns 생성된 피드백(FeedbackView)
   */
  async createFeedback(costumeId: number, dto: CreateFeedbackDto): Promise<FeedbackView> {
    const costume = await this.repo.findOne({ where: { id: costumeId } });
    if (!costume) throw new NotFoundException("코스튬을 찾을 수 없습니다.");

    if (dto.kind === "price") {
      if (dto.price == null || dto.price <= 0)
        throw new BadRequestException("시세(가격)를 올바르게 입력해주세요.");
    } else {
      if (!dto.content || !dto.content.trim())
        throw new BadRequestException("수정 요청 내용을 입력해주세요.");
    }

    const row = this.fbRepo.create({
      costumeId,
      kind: dto.kind,
      price: dto.kind === "price" && dto.price != null ? String(dto.price) : null,
      priceUnit: dto.priceUnit?.trim() || "",
      field: dto.field?.trim() || "",
      content: dto.content?.trim() || "",
      authorName: dto.authorName?.trim() || null,
      guestPassword: dto.password ? hashPassword(dto.password) : null,
      status: "open",
    });
    const saved = await this.fbRepo.save(row);
    return this.toView(saved);
  }

  /**
   * 피드백 삭제 — 관리자(x-admin-token)면 무조건, 아니면 본인 비밀번호 일치 시.
   * @param fid — 피드백 id
   * @param password — 본인 비밀번호(선택)
   * @param adminToken — x-admin-token 헤더값(선택)
   */
  async deleteFeedback(
    fid: number,
    password?: string,
    adminToken?: string,
  ): Promise<{ ok: boolean }> {
    const row = await this.fbRepo
      .createQueryBuilder("f")
      .addSelect("f.guestPassword")
      .where("f.id = :id", { id: fid })
      .getOne();
    if (!row) throw new NotFoundException("대상을 찾을 수 없습니다.");

    const isAdmin = !!process.env.ADMIN_TOKEN && adminToken === process.env.ADMIN_TOKEN;
    if (!isAdmin) {
      if (!row.guestPassword)
        throw new ForbiddenException("비밀번호가 없어 관리자만 삭제할 수 있습니다.");
      if (!password || !verifyPassword(password, row.guestPassword))
        throw new ForbiddenException("비밀번호가 일치하지 않습니다.");
    }
    await this.fbRepo.delete({ id: fid });
    return { ok: true };
  }

  /**
   * 수정 요청 상태 변경(관리자 전용 컨트롤러에서 호출).
   * @param fid — 피드백 id
   * @param status — "open" | "resolved" (기본 resolved)
   */
  async resolveFeedback(fid: number, status?: "open" | "resolved"): Promise<{ ok: boolean; status: string }> {
    const s = status === "open" ? "open" : "resolved";
    const res = await this.fbRepo.update({ id: fid }, { status: s });
    if (!res.affected) throw new NotFoundException("대상을 찾을 수 없습니다.");
    return { ok: true, status: s };
  }
}
