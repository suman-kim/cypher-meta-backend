/**
 * banned-word.service.ts
 * ------------------------------------------------------------------
 * 커뮤니티 금칙어 서비스.
 *  - 작성 검사: 게시글·댓글의 제목/내용/닉네임에 금칙어가 있으면 400(code: BANNED_WORDS)과 함께
 *    걸린 위치 목록(matches)을 돌려준다. 프론트는 이 위치로 원문을 강조 표시한다.
 *  - 관리자: 목록 조회·추가(여러 개 한 번에)·삭제·기본 목록 추가.
 *  - banned_words 표는 운영(DB_SYNC=false)에서도 첫 사용 시 idempotent 생성하고,
 *    처음 만들 때만 기본 금칙어를 넣는다(관리자가 지운 단어는 재부팅해도 되살아나지 않음).
 *  - 목록은 메모리에 캐시하고 변경 시 즉시, 그 외엔 CACHE_TTL_MS 마다 다시 읽는다(다중 인스턴스 대비).
 * ------------------------------------------------------------------
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository, Table } from "typeorm";
import { BannedWord } from "../database/entities";
import {
  BannedWordEntry,
  DEFAULT_BANNED_WORDS,
  findBannedMatches,
  normalizeWord,
} from "./banned-word.util";

/** 금칙어 캐시 유효 시간 — 다른 인스턴스에서 바꾼 목록도 이 시간 안에 반영된다 */
const CACHE_TTL_MS = 60_000;

/** 금칙어 검사·관리 서비스 */
@Injectable()
export class BannedWordService {
  private readonly logger = new Logger(BannedWordService.name);
  // 비교용 캐시(원문 + 정규화 형태)와 마지막 적재 시각
  private cache: BannedWordEntry[] = [];
  private loadedAt = 0;
  // 표 생성(+최초 시드)을 한 번만 수행하기 위한 Promise
  private readyPromise: Promise<void> | null = null;

  /**
   * @param repo — BannedWord 리포지토리 (DI 주입)
   * @param dataSource — 표 생성에 쓰는 TypeORM DataSource (DI 주입)
   */
  constructor(
    @InjectRepository(BannedWord) private readonly repo: Repository<BannedWord>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 게시글·댓글 입력에 금칙어가 있는지 검사한다.
   * @param fields — 필드 키(title/content/guestName) → 원문
   * @throws BadRequestException — 금칙어가 있으면 { code: "BANNED_WORDS", message, matches }
   */
  async assertClean(fields: Record<string, string | null | undefined>): Promise<void> {
    const words = await this.entries();
    if (words.length === 0) return;
    const matches = findBannedMatches(fields, words);
    if (matches.length === 0) return;
    const found = [...new Set(matches.map((m) => m.word))];
    throw new BadRequestException({
      statusCode: 400,
      error: "Bad Request",
      code: "BANNED_WORDS",
      message: `사용할 수 없는 표현이 포함되어 있습니다: ${found.join(", ")}`,
      matches,
    });
  }

  /**
   * 관리자용 금칙어 목록(최근 등록순).
   * @returns 금칙어 행 배열
   */
  async list(): Promise<BannedWord[]> {
    await this.ready();
    return this.repo.find({ order: { createdAt: "DESC", id: "DESC" } });
  }

  /**
   * 금칙어를 추가한다. 앞뒤 공백을 지우고, 정규화 형태가 이미 있는 단어(예: "씨 발" vs "씨발")는 건너뛴다.
   * @param words — 추가할 단어들
   * @returns 추가된 단어와 건너뛴 단어(중복·기호만 있는 단어)
   */
  async add(words: string[]): Promise<{ added: string[]; skipped: string[] }> {
    await this.ready();
    const result = await this.insertWords(words);
    this.loadedAt = 0; // 다음 검사에서 즉시 다시 읽기
    return result;
  }

  /**
   * 기본 금칙어 목록 중 없는 단어만 추가한다.
   * @returns 추가된 단어와 건너뛴 단어
   */
  async addDefaults(): Promise<{ added: string[]; skipped: string[] }> {
    return this.add(DEFAULT_BANNED_WORDS);
  }

  /**
   * 금칙어를 삭제한다.
   * @param id — 금칙어 ID(없으면 404)
   * @returns 성공 시 { ok: true }
   */
  async remove(id: number): Promise<{ ok: true }> {
    await this.ready();
    const r = await this.repo.delete({ id });
    if (!r.affected) throw new NotFoundException("금칙어를 찾을 수 없습니다.");
    this.loadedAt = 0;
    return { ok: true };
  }

  /**
   * 비교용 금칙어 목록(캐시). TTL 이 지났으면 DB 에서 다시 읽는다.
   * @returns 원문 + 정규화 형태 배열
   */
  private async entries(): Promise<BannedWordEntry[]> {
    await this.ready();
    if (Date.now() - this.loadedAt > CACHE_TTL_MS) {
      const rows = await this.repo.find({ select: ["word"] });
      this.cache = rows.map((r) => ({ word: r.word, norm: normalizeWord(r.word) })).filter((e) => e.norm);
      this.loadedAt = Date.now();
    }
    return this.cache;
  }

  /**
   * 중복을 걸러 금칙어를 넣는다(ready() 를 기다리지 않는 내부용 — 표 생성 직후 시드에도 사용).
   * @param words — 추가할 단어들
   * @returns 추가된 단어와 건너뛴 단어
   */
  private async insertWords(words: string[]): Promise<{ added: string[]; skipped: string[] }> {
    const existing = await this.repo.find({ select: ["word"] });
    const seen = new Set(existing.map((r) => normalizeWord(r.word)));
    const added: string[] = [];
    const skipped: string[] = [];
    for (const raw of words) {
      const word = raw.trim();
      const norm = normalizeWord(word);
      if (!word || !norm || seen.has(norm)) {
        if (word) skipped.push(word);
        continue;
      }
      seen.add(norm);
      added.push(word);
    }
    if (added.length) await this.repo.insert(added.map((word) => ({ word })));
    return { added, skipped };
  }

  /**
   * banned_words 표 준비(최초 1회). 실패하면 다음 호출에서 다시 시도한다.
   * @returns 준비 완료 Promise
   */
  private ready(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.ensureTable().catch((e) => {
        this.readyPromise = null;
        throw e;
      });
    }
    return this.readyPromise;
  }

  /**
   * banned_words 표를 엔티티 메타데이터로 idempotent 생성하고, 새로 만들었을 때만 기본 금칙어를 넣는다.
   * (운영 DB_SYNC=false 대응 — CollectionConfigService.ensureTables 와 같은 패턴)
   */
  private async ensureTable(): Promise<void> {
    const meta = this.dataSource.getMetadata(BannedWord);
    const qr = this.dataSource.createQueryRunner();
    let created = false;
    try {
      await qr.connect();
      if (!(await qr.hasTable(meta.tableName))) {
        await qr.createTable(Table.create(meta, this.dataSource.driver), true, false, true);
        created = true;
        this.logger.log(`테이블 생성: ${meta.tableName}`);
      }
    } finally {
      await qr.release();
    }
    if (created) {
      const { added } = await this.insertWords(DEFAULT_BANNED_WORDS);
      this.logger.log(`기본 금칙어 ${added.length}개 등록`);
    }
  }
}
