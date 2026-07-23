import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { CommunityService } from "./community.service";
import {
  CreateCommentDto,
  CreatePostDto,
  ListPostsQuery,
  PasswordDto,
  TrendingQuery,
} from "./dto";

@Controller("community")
export class CommunityController {
  constructor(private readonly svc: CommunityService) {}

  /** 게시글 목록 (공지 고정 + 페이지네이션 + 검색) */
  @Get("posts")
  list(@Query() q: ListPostsQuery) {
    return this.svc.listPosts(q.board ?? "free", q.page ?? 1, q.pageSize ?? 15, q.q);
  }

  /** 트렌딩(추천순 상위) */
  @Get("posts/trending")
  trending(@Query() q: TrendingQuery) {
    return this.svc.trending(q.board ?? "free", q.limit ?? 3);
  }

  /** 전체 공지(우측 사이드바용) */
  @Get("notices")
  notices(@Query("limit") limit?: string) {
    return this.svc.notices(limit ? Number(limit) : 5);
  }

  /** 전체 게시판 최신 글(홈용) */
  @Get("recent")
  recent(@Query("limit") limit?: string) {
    return this.svc.recent(limit ? Number(limit) : 5);
  }

  /** 게시글 상세(+댓글). 조회수 증가 */
  @Get("posts/:id")
  detail(@Param("id") id: string) {
    return this.svc.getPost(id);
  }

  /** 글 작성 (비회원: 닉네임+비밀번호) */
  @Post("posts")
  create(@Body() dto: CreatePostDto) {
    return this.svc.createPost(dto);
  }

  /** 추천 */
  @Post("posts/:id/like")
  like(@Param("id") id: string) {
    return this.svc.likePost(id);
  }

  /** 글 삭제 (비밀번호 확인) */
  @Post("posts/:id/delete")
  remove(@Param("id") id: string, @Body() dto: PasswordDto) {
    return this.svc.deletePost(id, dto.password);
  }

  /** 댓글 작성 (비회원) */
  @Post("posts/:id/comments")
  comment(@Param("id") id: string, @Body() dto: CreateCommentDto) {
    return this.svc.addComment(id, dto);
  }

  /** 댓글 삭제 (비밀번호 확인) */
  @Post("comments/:id/delete")
  removeComment(@Param("id") id: string, @Body() dto: PasswordDto) {
    return this.svc.deleteComment(id, dto.password);
  }
}
