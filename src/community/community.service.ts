/**
 * community.service.ts
 * ------------------------------------------------------------------
 * 커뮤니티(게시판) 도메인의 핵심 비즈니스 로직.
 * TypeORM Repository(Post, Comment)를 사용해 게시글/댓글의
 * 목록·상세·작성·추천·삭제 및 관리자 관리 기능을 구현한다.
 *  - 비회원 글/댓글은 scrypt 해시 비밀번호로 삭제 권한을 검증한다.
 *  - guestPassword 는 응답에서 항상 제거해 노출을 방지한다.
 *  - 모듈 부팅 시 COMMUNITY_RESET 환경변수에 따라 1회 초기화가 가능하다.
 * ------------------------------------------------------------------
 */
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Comment, Post } from "../database/entities";
import {
  AdminCreatePostDto,
  AdminUpdatePostDto,
  CreateCommentDto,
  CreatePostDto,
} from "./dto";
import { hashPassword, verifyPassword } from "./password.util";

// 게시글/댓글 id 파라미터가 올바른 UUID v4 형식인지 검사하기 위한 정규식.
// (SQL 조회 전에 형식을 먼저 걸러 잘못된 입력을 404 로 처리)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 커뮤니티 게시글/댓글 서비스.
 * 컨트롤러에서 위임받은 게시판 로직을 처리하며,
 * OnModuleInit 을 구현해 부팅 시 선택적 초기화를 수행한다.
 */
@Injectable()
export class CommunityService implements OnModuleInit {
  // 초기화/에러 상황을 남기기 위한 Nest 로거.
  private readonly logger = new Logger(CommunityService.name);

  /**
   * @param posts — 게시글(Post) TypeORM 리포지토리 (DI 주입)
   * @param comments — 댓글(Comment) TypeORM 리포지토리 (DI 주입)
   */
  constructor(
    @InjectRepository(Post) private readonly posts: Repository<Post>,
    @InjectRepository(Comment) private readonly comments: Repository<Comment>,
  ) {}

  /**
   * 모듈 초기화 훅. 부팅 시점에 1회 호출된다.
   * COMMUNITY_RESET 환경변수가 "true" 일 때만 커뮤니티 게시글/댓글을 전부 삭제한다.
   * @returns 초기화 처리 완료 Promise (반환값 없음)
   */
  /**
   * 자동 시드는 하지 않는다.
   * COMMUNITY_RESET=true 인 경우에만 부팅 시 커뮤니티 게시글/댓글을 전부 삭제한다(1회 초기화용).
   * ⚠️ 초기화 후에는 반드시 COMMUNITY_RESET 를 false 로 되돌릴 것(재시작마다 삭제됨).
   */
  async onModuleInit() {
    if (process.env.COMMUNITY_RESET === "true") {
      try {
        await this.comments.clear();
        await this.posts.clear();
        this.logger.warn(
          "COMMUNITY_RESET=true → 커뮤니티 게시글/댓글을 모두 삭제했습니다. (.env 에서 다시 false 로 되돌리세요)",
        );
      } catch (e) {
        this.logger.warn(`커뮤니티 리셋 실패: ${(e as Error).message}`);
      }
    }
  }

  /**
   * 응답 객체에서 비회원 비밀번호(guestPassword) 필드를 제거한다.
   * @param row — guestPassword 를 포함할 수 있는 임의의 엔티티/객체
   * @returns guestPassword 를 제외한 나머지 필드로 구성된 객체
   */
  /** guestPassword 는 select:false 라 일반 조회에는 포함되지 않지만, 안전하게 한 번 더 제거 */
  private strip<T extends { guestPassword?: string | null }>(row: T): Omit<T, "guestPassword"> {
    const { guestPassword: _omit, ...rest } = row;
    return rest;
  }

  /**
   * 특정 게시판의 게시글 목록을 페이지네이션 + 검색 조건으로 조회한다.
   * 공지(isNotice)는 목록에서 제외하되, 검색이 없을 때만 별도로 상단 고정 공지를 함께 반환한다.
   * @param board — 게시판 타입(free/guide/humor/video 등)
   * @param page — 페이지 번호(1부터). 기본 1
   * @param pageSize — 페이지당 항목 수. 기본 15
   * @param q — 제목/내용 검색어(선택)
   * @returns { items, notices, total, page, pageSize }
   */
  async listPosts(board: string, page = 1, pageSize = 15, q?: string) {
    const search = q?.trim();

    const qb = this.posts
      .createQueryBuilder("p")
      .where("p.boardType = :board", { board })
      .andWhere("p.isNotice = false");
    if (search) {
      qb.andWhere("(p.title ILIKE :q OR p.content ILIKE :q)", { q: `%${search}%` });
    }

    const total = await qb.getCount();
    const items = await qb
      .clone()
      .orderBy("p.seq", "DESC")
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    const notices = search
      ? []
      : await this.posts.find({
          where: { boardType: board, isNotice: true },
          order: { seq: "DESC" },
          take: 5,
        });

    return { items, notices, total, page, pageSize };
  }

  /**
   * 특정 게시판의 트렌딩 게시글(추천순, 동점 시 최신순) 상위 N개를 조회한다.
   * @param board — 게시판 타입
   * @param limit — 가져올 개수. 기본 3
   * @returns 추천 수 상위 게시글 배열
   */
  async trending(board: string, limit = 3) {
    return this.posts.find({
      where: { boardType: board, isNotice: false },
      order: { likes: "DESC", seq: "DESC" },
      take: limit,
    });
  }

  /**
   * 전체 게시판의 공지 게시글을 최신순으로 조회한다.
   * @param limit — 가져올 개수. 기본 5
   * @returns 공지 게시글 배열
   */
  async notices(limit = 5) {
    return this.posts.find({
      where: { isNotice: true },
      order: { seq: "DESC" },
      take: limit,
    });
  }

  /**
   * 전체 게시판의 최신 글(공지 제외)을 조회한다. 홈 화면 등에서 사용.
   * @param limit — 가져올 개수. 기본 5
   * @returns 최신순 게시글 배열
   */
  /** 홈 등에서 쓰는 전체 게시판 최신 글 (공지 제외) */
  async recent(limit = 5) {
    return this.posts.find({
      where: { isNotice: false },
      order: { seq: "DESC" },
      take: limit,
    });
  }

  /**
   * 게시글 상세를 조회하고 조회수를 1 증가시킨다. 댓글 목록도 함께 반환한다.
   * @param id — 게시글 UUID(형식 불량 또는 미존재 시 404)
   * @returns 게시글 본문 + 오름차순 정렬된 댓글 목록({ ...post, comments })
   */
  async getPost(id: string) {
    if (!UUID_RE.test(id)) throw new NotFoundException("게시글을 찾을 수 없습니다.");
    const post = await this.posts.findOne({ where: { id } });
    if (!post) throw new NotFoundException("게시글을 찾을 수 없습니다.");
    await this.posts.increment({ id }, "views", 1);
    post.views += 1;
    const comments = await this.comments.find({
      where: { postId: id },
      order: { createdAt: "ASC" },
    });
    return { ...post, comments };
  }

  /**
   * 비회원 게시글을 생성한다. 비밀번호는 scrypt 로 해시해 저장한다.
   * @param dto — 작성 본문(board/category/title/content/guestName/password)
   * @returns 생성된 게시글의 { id, seq }
   */
  async createPost(dto: CreatePostDto) {
    const post = this.posts.create({
      boardType: dto.board,
      category: dto.category ?? "free",
      isNotice: false,
      title: dto.title.trim(),
      content: dto.content,
      authorName: dto.guestName.trim(),
      guestPassword: hashPassword(dto.password),
    });
    const saved = await this.posts.save(post);
    return { id: saved.id, seq: saved.seq };
  }

  /**
   * 게시글 추천 수를 1 증가시킨다.
   * @param id — 게시글 UUID(형식 불량 또는 미존재 시 404)
   * @returns 증가 후 추천 수({ likes })
   */
  async likePost(id: string) {
    if (!UUID_RE.test(id)) throw new NotFoundException("게시글을 찾을 수 없습니다.");
    const post = await this.posts.findOne({ where: { id } });
    if (!post) throw new NotFoundException("게시글을 찾을 수 없습니다.");
    await this.posts.increment({ id }, "likes", 1);
    return { likes: post.likes + 1 };
  }

  /**
   * 비회원 게시글을 비밀번호 검증 후 삭제한다(공지는 삭제 불가). 딸린 댓글도 함께 삭제한다.
   * @param id — 게시글 UUID(형식 불량 또는 미존재 시 404)
   * @param password — 작성 시 입력한 비회원 비밀번호(불일치 시 403)
   * @returns 성공 시 { ok: true }
   */
  async deletePost(id: string, password: string) {
    if (!UUID_RE.test(id)) throw new NotFoundException("게시글을 찾을 수 없습니다.");
    const post = await this.posts
      .createQueryBuilder("p")
      .addSelect("p.guestPassword")
      .where("p.id = :id", { id })
      .getOne();
    if (!post) throw new NotFoundException("게시글을 찾을 수 없습니다.");
    if (post.isNotice) throw new ForbiddenException("공지는 삭제할 수 없습니다.");
    if (!verifyPassword(password, post.guestPassword)) {
      throw new ForbiddenException("비밀번호가 일치하지 않습니다.");
    }
    await this.comments.delete({ postId: id });
    await this.posts.delete({ id });
    return { ok: true };
  }

  /**
   * 게시글에 비회원 댓글을 추가하고 게시글의 댓글 수를 1 증가시킨다.
   * @param postId — 대상 게시글 UUID(형식 불량 또는 미존재 시 404)
   * @param dto — 댓글 본문(content/guestName/password)
   * @returns 저장된 댓글(guestPassword 제외)
   */
  async addComment(postId: string, dto: CreateCommentDto) {
    if (!UUID_RE.test(postId)) throw new NotFoundException("게시글을 찾을 수 없습니다.");
    const post = await this.posts.findOne({ where: { id: postId } });
    if (!post) throw new NotFoundException("게시글을 찾을 수 없습니다.");
    const comment = this.comments.create({
      postId,
      authorName: dto.guestName.trim(),
      guestPassword: hashPassword(dto.password),
      content: dto.content,
    });
    const saved = await this.comments.save(comment);
    await this.posts.increment({ id: postId }, "commentCount", 1);
    return this.strip(saved);
  }

  /**
   * 비회원 댓글을 비밀번호 검증 후 삭제하고 게시글의 댓글 수를 1 감소시킨다.
   * @param id — 댓글 UUID(형식 불량 또는 미존재 시 404)
   * @param password — 작성 시 입력한 비회원 비밀번호(불일치 시 403)
   * @returns 성공 시 { ok: true }
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
    await this.comments.delete({ id });
    await this.posts.decrement({ id: comment.postId }, "commentCount", 1);
    return { ok: true };
  }

  /* ─────────────── 관리자(게시판/공지 관리) ─────────────── */

  /**
   * 관리자용 전체 글 목록을 조회한다(공지 포함, 게시판/검색/공지 필터).
   * 정렬은 공지 우선, 그다음 순번(seq) 내림차순.
   * @param page — 페이지 번호. 기본 1
   * @param pageSize — 페이지당 항목 수. 기본 20
   * @param q — 제목/내용 검색어(선택)
   * @param board — 게시판 타입 필터(선택)
   * @param noticeOnly — true 면 공지만 조회. 기본 false
   * @returns { items, total, page, pageSize }
   */
  /** 전체 글 목록(공지 포함, 게시판/검색 필터). 공지 먼저, 그다음 최신순. */
  async adminListPosts(
    page = 1,
    pageSize = 20,
    q?: string,
    board?: string,
    noticeOnly = false,
  ) {
    const search = q?.trim();
    const qb = this.posts.createQueryBuilder("p").where("1 = 1");
    if (noticeOnly) qb.andWhere("p.isNotice = true");
    if (board) qb.andWhere("p.boardType = :board", { board });
    if (search) qb.andWhere("(p.title ILIKE :q OR p.content ILIKE :q)", { q: `%${search}%` });

    const total = await qb.getCount();
    const items = await qb
      .clone()
      .orderBy("p.isNotice", "DESC")
      .addOrderBy("p.seq", "DESC")
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    return { items, total, page, pageSize };
  }

  /**
   * 관리자용 공지/글을 작성한다(비밀번호 없음). 기본적으로 공지(isNotice=true)로 생성된다.
   * @param dto — 관리자 작성 본문(board/category/title/content/isNotice/authorName)
   * @returns 생성된 게시글의 { id, seq }
   */
  /** 공지/글 작성 (관리자 — 비밀번호 없음). 기본 isNotice=true. */
  async adminCreatePost(dto: AdminCreatePostDto) {
    const post = this.posts.create({
      boardType: dto.board,
      category: dto.category ?? "info",
      isNotice: dto.isNotice ?? true,
      title: dto.title.trim(),
      content: dto.content,
      authorId: null,
      authorName: (dto.authorName ?? "관리자").trim(),
      guestPassword: null,
    });
    const saved = await this.posts.save(post);
    return { id: saved.id, seq: saved.seq };
  }

  /**
   * 관리자용 글/공지를 수정한다. dto 에 실제로 전달된 필드만 부분 업데이트하며 비밀번호 컬럼은 보존한다.
   * @param id — 대상 게시글 UUID(형식 불량 또는 미존재 시 404)
   * @param dto — 수정할 필드만 담은 본문(모두 선택적)
   * @returns 성공 시 { ok: true } (변경할 필드가 없으면 그대로 { ok: true })
   */
  /** 글/공지 수정 (관리자). update 로 지정 필드만 변경(비밀번호 컬럼 보존). */
  async adminUpdatePost(id: string, dto: AdminUpdatePostDto) {
    if (!UUID_RE.test(id)) throw new NotFoundException("게시글을 찾을 수 없습니다.");
    const patch: Partial<Post> = {};
    if (dto.board !== undefined) patch.boardType = dto.board;
    if (dto.category !== undefined) patch.category = dto.category;
    if (dto.title !== undefined) patch.title = dto.title.trim();
    if (dto.content !== undefined) patch.content = dto.content;
    if (dto.isNotice !== undefined) patch.isNotice = dto.isNotice;
    if (Object.keys(patch).length === 0) return { ok: true };
    const r = await this.posts.update({ id }, patch);
    if (!r.affected) throw new NotFoundException("게시글을 찾을 수 없습니다.");
    return { ok: true };
  }

  /**
   * 관리자용 글 삭제(비밀번호 없이, 공지 포함). 딸린 댓글도 함께 삭제한다.
   * @param id — 대상 게시글 UUID(형식 불량 또는 미존재 시 404)
   * @returns 성공 시 { ok: true }
   */
  /** 글 삭제 (관리자 — 비밀번호 없이, 공지 포함). 댓글도 함께 삭제. */
  async adminDeletePost(id: string) {
    if (!UUID_RE.test(id)) throw new NotFoundException("게시글을 찾을 수 없습니다.");
    const post = await this.posts.findOne({ where: { id } });
    if (!post) throw new NotFoundException("게시글을 찾을 수 없습니다.");
    await this.comments.delete({ postId: id });
    await this.posts.delete({ id });
    return { ok: true };
  }

  /**
   * 관리자용 공지 지정/해제.
   * @param id — 대상 게시글 UUID(형식 불량 또는 미존재 시 404)
   * @param isNotice — true 면 공지 지정, false 면 해제
   * @returns 성공 시 { ok: true, isNotice }
   */
  /** 공지 지정/해제 (관리자). */
  async adminSetNotice(id: string, isNotice: boolean) {
    if (!UUID_RE.test(id)) throw new NotFoundException("게시글을 찾을 수 없습니다.");
    const r = await this.posts.update({ id }, { isNotice });
    if (!r.affected) throw new NotFoundException("게시글을 찾을 수 없습니다.");
    return { ok: true, isNotice };
  }

  /**
   * 관리자용 특정 글의 댓글 목록을 오름차순으로 조회한다.
   * @param postId — 대상 게시글 UUID(형식 불량 또는 미존재 시 404)
   * @returns 댓글 배열(각 항목에서 guestPassword 제외)
   */
  /** 특정 글의 댓글 목록 (관리자). */
  async adminListComments(postId: string) {
    if (!UUID_RE.test(postId)) throw new NotFoundException("게시글을 찾을 수 없습니다.");
    const rows = await this.comments.find({
      where: { postId },
      order: { createdAt: "ASC" },
    });
    return rows.map((c) => this.strip(c));
  }

  /**
   * 관리자용 댓글 삭제(비밀번호 없이). 게시글의 댓글 수를 1 감소시킨다.
   * @param id — 대상 댓글 UUID(형식 불량 또는 미존재 시 404)
   * @returns 성공 시 { ok: true }
   */
  /** 댓글 삭제 (관리자 — 비밀번호 없이). */
  async adminDeleteComment(id: string) {
    if (!UUID_RE.test(id)) throw new NotFoundException("댓글을 찾을 수 없습니다.");
    const comment = await this.comments.findOne({ where: { id } });
    if (!comment) throw new NotFoundException("댓글을 찾을 수 없습니다.");
    await this.comments.delete({ id });
    await this.posts.decrement({ id: comment.postId }, "commentCount", 1);
    return { ok: true };
  }
}
