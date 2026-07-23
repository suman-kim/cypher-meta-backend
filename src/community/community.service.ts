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
import { CreateCommentDto, CreatePostDto } from "./dto";
import { hashPassword, verifyPassword } from "./password.util";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class CommunityService implements OnModuleInit {
  private readonly logger = new Logger(CommunityService.name);

  constructor(
    @InjectRepository(Post) private readonly posts: Repository<Post>,
    @InjectRepository(Comment) private readonly comments: Repository<Comment>,
  ) {}

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

  /** guestPassword 는 select:false 라 일반 조회에는 포함되지 않지만, 안전하게 한 번 더 제거 */
  private strip<T extends { guestPassword?: string | null }>(row: T): Omit<T, "guestPassword"> {
    const { guestPassword: _omit, ...rest } = row;
    return rest;
  }

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

  async trending(board: string, limit = 3) {
    return this.posts.find({
      where: { boardType: board, isNotice: false },
      order: { likes: "DESC", seq: "DESC" },
      take: limit,
    });
  }

  async notices(limit = 5) {
    return this.posts.find({
      where: { isNotice: true },
      order: { seq: "DESC" },
      take: limit,
    });
  }

  /** 홈 등에서 쓰는 전체 게시판 최신 글 (공지 제외) */
  async recent(limit = 5) {
    return this.posts.find({
      where: { isNotice: false },
      order: { seq: "DESC" },
      take: limit,
    });
  }

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

  async likePost(id: string) {
    if (!UUID_RE.test(id)) throw new NotFoundException("게시글을 찾을 수 없습니다.");
    const post = await this.posts.findOne({ where: { id } });
    if (!post) throw new NotFoundException("게시글을 찾을 수 없습니다.");
    await this.posts.increment({ id }, "likes", 1);
    return { likes: post.likes + 1 };
  }

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
}
