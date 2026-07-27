/**
 * updates.service.ts — 업데이트 노트(패치노트) 비즈니스 로직.
 * 공개 조회(발행분만)와 관리자 CRUD(초안 포함)를 담당한다.
 */
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { UpdateComment, UpdateNote } from "../database/entities";
import { CreateUpdateCommentDto, CreateUpdateDto, UpdateUpdateDto } from "./dto";
import { hashPassword, verifyPassword } from "../community/password.util";

/** 댓글/업데이트 id UUID 형식 검사(조회 전 잘못된 입력을 404 처리) */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class UpdatesService {
  /**
   * @param repo — UpdateNote 리포지토리(의존성 주입)
   */
  constructor(
    @InjectRepository(UpdateNote)
    private readonly repo: Repository<UpdateNote>,
    @InjectRepository(UpdateComment)
    private readonly comments: Repository<UpdateComment>,
  ) {}

  /**
   * 공개 목록 조회(발행분만, 최신순).
   * @param limit — 가져올 개수(기본 20, 1~100 보정)
   * @param offset — 건너뛸 개수(기본 0)
   * @returns { items, total } — 발행된 업데이트 노트 배열과 전체 발행 개수
   */
  async listPublished(limit = 20, offset = 0): Promise<{ items: UpdateNote[]; total: number }> {
    const take = Math.min(100, Math.max(1, limit));
    const skip = Math.max(0, offset);
    const [items, total] = await this.repo.findAndCount({
      where: { published: true },
      order: { createdAt: "DESC" },
      take,
      skip,
    });
    return { items, total };
  }

  /**
   * 최신 발행 업데이트 1건(메인 카드·NEW 뱃지·팝업용).
   * @returns 가장 최근 발행 노트, 없으면 null
   */
  latestPublished(): Promise<UpdateNote | null> {
    return this.repo.findOne({ where: { published: true }, order: { createdAt: "DESC" } });
  }

  /**
   * 발행된 단건 조회.
   * @param id — 업데이트 노트 ID
   * @returns 발행된 노트. 없거나 미발행이면 NotFoundException
   */
  async getPublished(id: string): Promise<UpdateNote> {
    const row = await this.repo.findOne({ where: { id, published: true } });
    if (!row) throw new NotFoundException("업데이트 노트를 찾을 수 없습니다.");
    return row;
  }

  /**
   * 관리자용 전체 목록(초안 포함, 최신순).
   * @returns 전체 업데이트 노트 배열
   */
  adminList(): Promise<UpdateNote[]> {
    return this.repo.find({ order: { createdAt: "DESC" } });
  }

  /**
   * 업데이트 노트 작성.
   * @param dto — version(선택)/title/content/published(기본 true)
   * @returns 저장된 노트
   */
  create(dto: CreateUpdateDto): Promise<UpdateNote> {
    const row = this.repo.create({
      version: dto.version?.trim() || null,
      title: dto.title.trim(),
      content: dto.content,
      published: dto.published ?? true,
    });
    return this.repo.save(row);
  }

  /**
   * 업데이트 노트 부분 수정.
   * @param id — 수정할 노트 ID
   * @param dto — 부분 필드(지정된 값만 반영)
   * @returns 수정된 노트. 없으면 NotFoundException
   */
  async update(id: string, dto: UpdateUpdateDto): Promise<UpdateNote> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException("업데이트 노트를 찾을 수 없습니다.");
    if (dto.version !== undefined) row.version = dto.version.trim() || null;
    if (dto.title !== undefined) row.title = dto.title.trim();
    if (dto.content !== undefined) row.content = dto.content;
    if (dto.published !== undefined) row.published = dto.published;
    return this.repo.save(row);
  }

  /**
   * 업데이트 노트 삭제.
   * @param id — 삭제할 노트 ID
   * @returns { ok: true }. 대상 없으면 NotFoundException
   */
  async remove(id: string): Promise<{ ok: true }> {
    const res = await this.repo.delete({ id });
    if (!res.affected) throw new NotFoundException("업데이트 노트를 찾을 수 없습니다.");
    return { ok: true };
  }

  /* ────────────── 댓글(비회원) ────────────── */

  /** guestPassword 필드를 응답에서 제거 */
  private strip<T extends { guestPassword?: string | null }>(row: T): Omit<T, "guestPassword"> {
    const { guestPassword: _omit, ...rest } = row;
    return rest;
  }

  /**
   * 특정 업데이트의 댓글 목록(오름차순).
   * @param updateId — 업데이트 노트 ID
   * @returns 댓글 배열(guestPassword 제외)
   */
  async listComments(updateId: string) {
    if (!UUID_RE.test(updateId)) throw new NotFoundException("업데이트 노트를 찾을 수 없습니다.");
    const rows = await this.comments.find({
      where: { updateId },
      order: { createdAt: "ASC" },
    });
    return rows.map((c) => this.strip(c));
  }

  /**
   * 비회원 댓글 작성. 발행된 업데이트에만 달 수 있으며 댓글 수를 1 증가시킨다.
   * @param updateId — 대상 업데이트 노트 ID
   * @param dto — 닉네임/비밀번호/내용
   * @returns 저장된 댓글(guestPassword 제외)
   */
  async addComment(updateId: string, dto: CreateUpdateCommentDto) {
    if (!UUID_RE.test(updateId)) throw new NotFoundException("업데이트 노트를 찾을 수 없습니다.");
    const note = await this.repo.findOne({ where: { id: updateId, published: true } });
    if (!note) throw new NotFoundException("업데이트 노트를 찾을 수 없습니다.");
    // 대댓글: 부모가 같은 업데이트에 있어야 하며, 한 단계로 정규화
    let parentId: string | null = null;
    if (dto.parentId) {
      const parent = await this.comments.findOne({ where: { id: dto.parentId, updateId } });
      if (!parent) throw new NotFoundException("원 댓글을 찾을 수 없습니다.");
      parentId = parent.parentId ?? parent.id;
    }
    const comment = this.comments.create({
      updateId,
      parentId,
      authorName: dto.guestName.trim(),
      guestPassword: hashPassword(dto.password),
      content: dto.content,
    });
    const saved = await this.comments.save(comment);
    await this.repo.increment({ id: updateId }, "commentCount", 1);
    return this.strip(saved);
  }

  /**
   * 비회원 댓글을 비밀번호 검증 후 삭제하고 댓글 수를 1 감소시킨다.
   * @param id — 댓글 ID
   * @param password — 작성 시 입력한 비밀번호(불일치 시 403)
   * @returns { ok: true }
   */
  async deleteComment(id: string, password: string) {
    if (!UUID_RE.test(id)) throw new NotFoundException("댓글을 찾을 수 없습니다.");
    const comment = await this.comments
      .createQueryBuilder("c")
      .addSelect("c.guestPassword")
      .where("c.id = :id", { id })
      .getOne();
    if (!comment) throw new NotFoundException("댓글을 찾을 수 없습니다.");
    if (!verifyPassword(password, comment.guestPassword)) {
      throw new ForbiddenException("비밀번호가 일치하지 않습니다.");
    }
    // 원댓글 삭제 시 대댓글도 함께 삭제
    const children = await this.comments.find({ where: { parentId: id } });
    const ids = [id, ...children.map((c) => c.id)];
    await this.comments.delete(ids);
    await this.repo.decrement({ id: comment.updateId }, "commentCount", ids.length);
    return { ok: true };
  }
}
