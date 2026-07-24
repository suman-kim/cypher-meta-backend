/**
 * community.controller.ts
 * ------------------------------------------------------------------
 * 커뮤니티(게시판) HTTP 컨트롤러.
 * `/community` 하위의 모든 REST 엔드포인트를 정의한다.
 *  - 일반 사용자(비회원) 게시글/댓글 CRUD: 목록·상세·작성·추천·삭제.
 *  - 관리자 전용 게시판/공지 관리(AdminGuard, x-admin-token 헤더로 보호).
 * 실제 비즈니스 로직은 CommunityService 로 위임하고, 여기서는 라우팅과
 * 요청 파라미터(Query/Param/Body) 바인딩만 담당한다.
 * ------------------------------------------------------------------
 */
import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AdminGuard } from "../analytics/admin.guard";
import { CommunityService } from "./community.service";
import {
  AdminCreatePostDto,
  AdminListQuery,
  AdminNoticeDto,
  AdminUpdatePostDto,
  CreateCommentDto,
  CreatePostDto,
  ListPostsQuery,
  PasswordDto,
  TrendingQuery,
} from "./dto";

/**
 * 커뮤니티 게시판 컨트롤러.
 * 라우트 프리픽스 `/community` 아래의 일반/관리자 엔드포인트를 처리한다.
 */
@Controller("community")
export class CommunityController {
  /**
   * @param svc — 게시글/댓글 관련 비즈니스 로직을 담당하는 CommunityService (DI 주입)
   */
  constructor(private readonly svc: CommunityService) {}

  /**
   * 게시글 목록 조회 (공지 고정 + 페이지네이션 + 검색).
   * 라우트: GET /community/posts
   * @param q — 쿼리 파라미터(board 게시판, page 페이지, pageSize 페이지 크기, q 검색어). 기본값 board="free", page=1, pageSize=15
   * @returns 목록 아이템·상단 고정 공지·전체 개수를 포함한 페이지 결과
   */
  /** 게시글 목록 (공지 고정 + 페이지네이션 + 검색) */
  @Get("posts")
  list(@Query() q: ListPostsQuery) {
    return this.svc.listPosts(q.board ?? "free", q.page ?? 1, q.pageSize ?? 15, q.q);
  }

  /**
   * 트렌딩 게시글(추천순 상위 N개) 조회.
   * 라우트: GET /community/posts/trending
   * @param q — 쿼리 파라미터(board 게시판, limit 개수). 기본값 board="free", limit=3
   * @returns 추천 수 상위 게시글 배열
   */
  /** 트렌딩(추천순 상위) */
  @Get("posts/trending")
  trending(@Query() q: TrendingQuery) {
    return this.svc.trending(q.board ?? "free", q.limit ?? 3);
  }

  /**
   * 전체 게시판 공지 목록(우측 사이드바용) 조회.
   * 라우트: GET /community/notices
   * @param limit — 가져올 공지 개수(문자열 쿼리). 미지정 시 5개
   * @returns 최신순 공지 게시글 배열
   */
  /** 전체 공지(우측 사이드바용) */
  @Get("notices")
  notices(@Query("limit") limit?: string) {
    return this.svc.notices(limit ? Number(limit) : 5);
  }

  /**
   * 전체 게시판 최신 글(홈 화면용) 조회.
   * 라우트: GET /community/recent
   * @param limit — 가져올 최신 글 개수(문자열 쿼리). 미지정 시 5개
   * @returns 공지를 제외한 최신순 게시글 배열
   */
  /** 전체 게시판 최신 글(홈용) */
  @Get("recent")
  recent(@Query("limit") limit?: string) {
    return this.svc.recent(limit ? Number(limit) : 5);
  }

  /**
   * 게시글 상세 조회(+댓글 포함). 조회 시 조회수를 1 증가시킨다.
   * 라우트: GET /community/posts/:id
   * @param id — 게시글 UUID(경로 파라미터)
   * @returns 게시글 본문 + 정렬된 댓글 목록
   */
  /** 게시글 상세(+댓글). 조회수 증가 */
  @Get("posts/:id")
  detail(@Param("id") id: string) {
    return this.svc.getPost(id);
  }

  /**
   * 게시글 작성(비회원: 닉네임 + 비밀번호).
   * 라우트: POST /community/posts
   * @param dto — 작성 본문(게시판/카테고리/제목/내용/작성자명/비밀번호)
   * @returns 생성된 게시글의 id와 순번(seq)
   */
  /** 글 작성 (비회원: 닉네임+비밀번호) */
  @Post("posts")
  create(@Body() dto: CreatePostDto) {
    return this.svc.createPost(dto);
  }

  /**
   * 게시글 추천(좋아요) 1 증가.
   * 라우트: POST /community/posts/:id/like
   * @param id — 게시글 UUID(경로 파라미터)
   * @returns 증가 후 추천 수({ likes })
   */
  /** 추천 */
  @Post("posts/:id/like")
  like(@Param("id") id: string) {
    return this.svc.likePost(id);
  }

  /**
   * 게시글 삭제(비회원 비밀번호 확인).
   * 라우트: POST /community/posts/:id/delete
   * @param id — 게시글 UUID(경로 파라미터)
   * @param dto — 비밀번호를 담은 본문
   * @returns 성공 시 { ok: true }
   */
  /** 글 삭제 (비밀번호 확인) */
  @Post("posts/:id/delete")
  remove(@Param("id") id: string, @Body() dto: PasswordDto) {
    return this.svc.deletePost(id, dto.password);
  }

  /**
   * 댓글 작성(비회원).
   * 라우트: POST /community/posts/:id/comments
   * @param id — 대상 게시글 UUID(경로 파라미터)
   * @param dto — 댓글 본문(내용/작성자명/비밀번호)
   * @returns 저장된 댓글(비밀번호 필드 제외)
   */
  /** 댓글 작성 (비회원) */
  @Post("posts/:id/comments")
  comment(@Param("id") id: string, @Body() dto: CreateCommentDto) {
    return this.svc.addComment(id, dto);
  }

  /**
   * 댓글 삭제(비회원 비밀번호 확인).
   * 라우트: POST /community/comments/:id/delete
   * @param id — 댓글 UUID(경로 파라미터)
   * @param dto — 비밀번호를 담은 본문
   * @returns 성공 시 { ok: true }
   */
  /** 댓글 삭제 (비밀번호 확인) */
  @Post("comments/:id/delete")
  removeComment(@Param("id") id: string, @Body() dto: PasswordDto) {
    return this.svc.deleteComment(id, dto.password);
  }

  /* ─────────────── 관리자 (AdminGuard: x-admin-token) ─────────────── */

  /**
   * 관리자용 전체 글 목록 조회(공지 포함, 게시판/검색/공지 필터).
   * 라우트: GET /community/admin/posts (AdminGuard 보호)
   * @param q — 관리자 목록 쿼리(page, pageSize, q 검색어, board 게시판, noticeOnly "true"면 공지만). 기본값 page=1, pageSize=20
   * @returns 관리자용 목록 아이템·전체 개수를 포함한 페이지 결과
   */
  /** 전체 글 목록(공지 포함) */
  @UseGuards(AdminGuard)
  @Get("admin/posts")
  adminList(@Query() q: AdminListQuery) {
    return this.svc.adminListPosts(
      q.page ?? 1,
      q.pageSize ?? 20,
      q.q,
      q.board,
      q.noticeOnly === "true",
    );
  }

  /**
   * 관리자용 공지/글 작성(비밀번호 없음).
   * 라우트: POST /community/admin/posts (AdminGuard 보호)
   * @param dto — 관리자 작성 본문(게시판/카테고리/제목/내용/공지여부/작성자명)
   * @returns 생성된 게시글의 id와 순번(seq)
   */
  /** 공지/글 작성 */
  @UseGuards(AdminGuard)
  @Post("admin/posts")
  adminCreate(@Body() dto: AdminCreatePostDto) {
    return this.svc.adminCreatePost(dto);
  }

  /**
   * 관리자용 글/공지 수정(지정한 필드만 부분 변경).
   * 라우트: POST /community/admin/posts/:id/update (AdminGuard 보호)
   * @param id — 대상 게시글 UUID(경로 파라미터)
   * @param dto — 수정할 필드만 담은 본문(모두 선택적)
   * @returns 성공 시 { ok: true }
   */
  /** 글/공지 수정 */
  @UseGuards(AdminGuard)
  @Post("admin/posts/:id/update")
  adminUpdate(@Param("id") id: string, @Body() dto: AdminUpdatePostDto) {
    return this.svc.adminUpdatePost(id, dto);
  }

  /**
   * 관리자용 글 삭제(비밀번호 없이, 공지 포함).
   * 라우트: POST /community/admin/posts/:id/delete (AdminGuard 보호)
   * @param id — 대상 게시글 UUID(경로 파라미터)
   * @returns 성공 시 { ok: true }
   */
  /** 글 삭제 (비밀번호 없이) */
  @UseGuards(AdminGuard)
  @Post("admin/posts/:id/delete")
  adminDelete(@Param("id") id: string) {
    return this.svc.adminDeletePost(id);
  }

  /**
   * 관리자용 공지 지정/해제.
   * 라우트: POST /community/admin/posts/:id/notice (AdminGuard 보호)
   * @param id — 대상 게시글 UUID(경로 파라미터)
   * @param dto — 공지 여부(isNotice)를 담은 본문
   * @returns 성공 시 { ok: true, isNotice }
   */
  /** 공지 지정/해제 */
  @UseGuards(AdminGuard)
  @Post("admin/posts/:id/notice")
  adminNotice(@Param("id") id: string, @Body() dto: AdminNoticeDto) {
    return this.svc.adminSetNotice(id, dto.isNotice);
  }

  /**
   * 관리자용 특정 글의 댓글 목록 조회.
   * 라우트: GET /community/admin/posts/:id/comments (AdminGuard 보호)
   * @param id — 대상 게시글 UUID(경로 파라미터)
   * @returns 해당 게시글의 댓글 배열(비밀번호 필드 제외)
   */
  /** 특정 글의 댓글 목록 */
  @UseGuards(AdminGuard)
  @Get("admin/posts/:id/comments")
  adminComments(@Param("id") id: string) {
    return this.svc.adminListComments(id);
  }

  /**
   * 관리자용 댓글 삭제(비밀번호 없이).
   * 라우트: POST /community/admin/comments/:id/delete (AdminGuard 보호)
   * @param id — 대상 댓글 UUID(경로 파라미터)
   * @returns 성공 시 { ok: true }
   */
  /** 댓글 삭제 (비밀번호 없이) */
  @UseGuards(AdminGuard)
  @Post("admin/comments/:id/delete")
  adminDeleteComment(@Param("id") id: string) {
    return this.svc.adminDeleteComment(id);
  }
}
