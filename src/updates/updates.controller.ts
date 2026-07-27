/**
 * updates.controller.ts — 업데이트 노트(패치노트) HTTP 컨트롤러.
 * 전역 prefix("api")가 적용되므로 실제 경로는 /api/updates/* 이다.
 *  - 공개: 목록/최신/단건 조회(발행분만)
 *  - 관리자(AdminGuard): 전체 목록·작성·수정·삭제
 * 관리자 경로는 커뮤니티(/community/admin/*)와 동일하게 /updates/admin/* 로 두고
 * 프론트 프록시(/api/admin/updates/[...path])가 x-admin-token 을 전달한다.
 */
import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AdminGuard } from "../analytics/admin.guard";
import { UpdatesService } from "./updates.service";
import {
  CreateUpdateCommentDto,
  CreateUpdateDto,
  DeleteUpdateCommentDto,
  ListUpdatesQuery,
  UpdateUpdateDto,
} from "./dto";

/**
 * 업데이트 노트 라우트 모음. 실제 로직은 UpdatesService 에 위임한다.
 * 베이스 경로: /api/updates
 */
@Controller("updates")
export class UpdatesController {
  /**
   * @param svc — 업데이트 노트 조회/CRUD 서비스(의존성 주입)
   */
  constructor(private readonly svc: UpdatesService) {}

  /**
   * 공개 목록 조회(발행분만, 최신순).
   * HTTP: GET /api/updates?limit=&offset=
   * @param q — limit/offset 쿼리
   * @returns { items, total }
   */
  @Get()
  list(@Query() q: ListUpdatesQuery) {
    return this.svc.listPublished(q.limit ?? 20, q.offset ?? 0);
  }

  /**
   * 최신 발행 업데이트 1건(메인 카드·NEW 뱃지·팝업용).
   * HTTP: GET /api/updates/latest
   * @returns { latest: UpdateNote | null }
   */
  @Get("latest")
  async latest() {
    return { latest: await this.svc.latestPublished() };
  }

  /* ── 관리자(작성/관리) — AdminGuard 로 보호. /latest 보다 아래에 두어 경로 충돌 방지 ── */

  /**
   * 관리자 전체 목록(초안 포함, 최신순).
   * HTTP: GET /api/updates/admin  (AdminGuard 필요)
   * @returns { items: UpdateNote[] }
   */
  @UseGuards(AdminGuard)
  @Get("admin")
  async adminList() {
    return { items: await this.svc.adminList() };
  }

  /**
   * 관리자 업데이트 노트 작성.
   * HTTP: POST /api/updates/admin  (AdminGuard 필요)
   * @param dto — version(선택)/title/content/published(기본 true)
   * @returns 저장된 노트
   */
  @UseGuards(AdminGuard)
  @Post("admin")
  create(@Body() dto: CreateUpdateDto) {
    return this.svc.create(dto);
  }

  /**
   * 관리자 업데이트 노트 수정.
   * HTTP: POST /api/updates/admin/:id/update  (AdminGuard 필요)
   * @param id — 수정할 노트 ID
   * @param dto — 부분 수정 필드
   * @returns 수정된 노트
   */
  @UseGuards(AdminGuard)
  @Post("admin/:id/update")
  update(@Param("id") id: string, @Body() dto: UpdateUpdateDto) {
    return this.svc.update(id, dto);
  }

  /**
   * 관리자 업데이트 노트 삭제.
   * HTTP: POST /api/updates/admin/:id/delete  (AdminGuard 필요)
   * @param id — 삭제할 노트 ID
   * @returns { ok: true }
   */
  @UseGuards(AdminGuard)
  @Post("admin/:id/delete")
  remove(@Param("id") id: string) {
    return this.svc.remove(id);
  }

  /* ────────────── 댓글(비회원, 공개) ────────────── */

  /**
   * 특정 업데이트의 댓글 목록.
   * HTTP: GET /api/updates/:id/comments
   * @param id — 업데이트 노트 ID
   * @returns 댓글 배열(비밀번호 제외)
   */
  @Get(":id/comments")
  listComments(@Param("id") id: string) {
    return this.svc.listComments(id);
  }

  /**
   * 비회원 댓글 작성.
   * HTTP: POST /api/updates/:id/comments
   * @param id — 대상 업데이트 노트 ID
   * @param dto — 닉네임/비밀번호/내용
   * @returns 저장된 댓글
   */
  @Post(":id/comments")
  addComment(@Param("id") id: string, @Body() dto: CreateUpdateCommentDto) {
    return this.svc.addComment(id, dto);
  }

  /**
   * 비회원 댓글 삭제(비밀번호 확인).
   * HTTP: POST /api/updates/comments/:cid/delete
   * @param cid — 댓글 ID
   * @param dto — 비밀번호
   * @returns { ok: true }
   */
  @Post("comments/:cid/delete")
  deleteComment(@Param("cid") cid: string, @Body() dto: DeleteUpdateCommentDto) {
    return this.svc.deleteComment(cid, dto.password);
  }

  /**
   * 공개 단건 조회(발행분만). 동적 세그먼트라 정적 경로(admin/latest) 뒤에 둔다.
   * HTTP: GET /api/updates/:id
   * @param id — 업데이트 노트 ID
   * @returns 발행된 노트
   */
  @Get(":id")
  getOne(@Param("id") id: string) {
    return this.svc.getPublished(id);
  }
}
