/**
 * report-targets.ts — 신고 대상 종류별 처리 구현(ReportTarget 전략)과 이를 모아 두는 등록부.
 *
 *  - PostReportTarget          : 커뮤니티 글(운영 중인 게시판의 글만, 공지는 신고 불가)
 *  - CommentReportTarget       : 커뮤니티 댓글
 *  - UpdateCommentReportTarget : 업데이트 노트 댓글
 * 사본 조회는 리포지토리로 직접 하고, 삭제는 각 도메인 서비스의 관리자 삭제를 그대로 써서
 * 댓글 수 보정·대댓글 삭제 같은 규칙이 한곳(도메인 서비스)에만 있게 한다.
 */
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Comment, Post, UpdateComment, UpdateNote } from "../database/entities";
import { CommunityService } from "../community/community.service";
import { BOARD_TYPES } from "../community/dto";
import { UpdatesService } from "../updates/updates.service";
import { clipText, SNAPSHOT_MAX, SNAPSHOT_TITLE_MAX, type ReportTargetType } from "./report-logic";
import type { ReportSnapshot, ReportTarget } from "./report-target";

/** UUID 형식 검사(조회 전에 잘못된 ID 를 걸러 DB 오류 대신 '없음'으로 처리) */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 도메인 서비스의 삭제를 부르고, '이미 없음(404)'은 false 로 바꾼다.
 * @param run — 삭제 함수
 * @returns 지웠으면 true, 이미 없으면 false
 */
async function removeOrMissing(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    return true;
  } catch (e) {
    if (e instanceof NotFoundException) return false;
    throw e;
  }
}

/**
 * 사본을 정해진 길이로 자른다.
 * @param snap — 원래 사본
 * @returns 제목·본문 길이를 맞춘 사본
 */
function fit(snap: ReportSnapshot): ReportSnapshot {
  return {
    ...snap,
    title: snap.title === null ? null : clipText(snap.title, SNAPSHOT_TITLE_MAX),
    content: clipText(snap.content, SNAPSHOT_MAX),
  };
}

/** 커뮤니티 글 신고 처리 */
@Injectable()
export class PostReportTarget implements ReportTarget {
  /** 맡는 대상 종류 */
  readonly type: ReportTargetType = "post";

  /**
   * @param posts — 게시글 리포지토리 (DI 주입)
   * @param community — 커뮤니티 서비스(관리자 삭제 사용) (DI 주입)
   */
  constructor(
    @InjectRepository(Post) private readonly posts: Repository<Post>,
    private readonly community: CommunityService,
  ) {}

  /**
   * 운영 중인 게시판의 일반 글이면 사본을 돌려준다(공지·숨김 게시판 글은 신고 대상 아님).
   * @param id — 글 ID
   * @returns 사본 또는 null
   */
  async snapshot(id: string): Promise<ReportSnapshot | null> {
    if (!UUID_RE.test(id)) return null;
    const post = await this.posts.findOne({ where: { id } });
    if (!post || post.isNotice || !BOARD_TYPES.includes(post.boardType)) return null;
    return fit({
      title: post.title,
      content: post.content,
      authorName: post.authorName,
      link: `/community/${post.boardType}/${post.id}`,
    });
  }

  /**
   * 글과 딸린 댓글을 지운다.
   * @param id — 글 ID
   * @returns 지웠으면 true, 이미 없으면 false
   */
  remove(id: string): Promise<boolean> {
    return removeOrMissing(() => this.community.adminDeletePost(id));
  }
}

/** 커뮤니티 댓글 신고 처리 */
@Injectable()
export class CommentReportTarget implements ReportTarget {
  /** 맡는 대상 종류 */
  readonly type: ReportTargetType = "comment";

  /**
   * @param comments — 댓글 리포지토리 (DI 주입)
   * @param posts — 게시글 리포지토리(소속 글 제목·경로용) (DI 주입)
   * @param community — 커뮤니티 서비스(관리자 삭제 사용) (DI 주입)
   */
  constructor(
    @InjectRepository(Comment) private readonly comments: Repository<Comment>,
    @InjectRepository(Post) private readonly posts: Repository<Post>,
    private readonly community: CommunityService,
  ) {}

  /**
   * 공개된 글에 달린 댓글이면 사본(제목은 소속 글 제목)을 돌려준다.
   * @param id — 댓글 ID
   * @returns 사본 또는 null
   */
  async snapshot(id: string): Promise<ReportSnapshot | null> {
    if (!UUID_RE.test(id)) return null;
    const comment = await this.comments.findOne({ where: { id } });
    if (!comment) return null;
    const post = await this.posts.findOne({ where: { id: comment.postId } });
    if (!post || !BOARD_TYPES.includes(post.boardType)) return null;
    return fit({
      title: post.title,
      content: comment.content,
      authorName: comment.authorName,
      link: `/community/${post.boardType}/${post.id}`,
    });
  }

  /**
   * 댓글과 대댓글을 지운다.
   * @param id — 댓글 ID
   * @returns 지웠으면 true, 이미 없으면 false
   */
  remove(id: string): Promise<boolean> {
    return removeOrMissing(() => this.community.adminDeleteComment(id));
  }
}

/** 업데이트 노트 댓글 신고 처리 */
@Injectable()
export class UpdateCommentReportTarget implements ReportTarget {
  /** 맡는 대상 종류 */
  readonly type: ReportTargetType = "update_comment";

  /**
   * @param comments — 업데이트 댓글 리포지토리 (DI 주입)
   * @param notes — 업데이트 노트 리포지토리(소속 노트 제목용) (DI 주입)
   * @param updates — 업데이트 서비스(관리자 삭제 사용) (DI 주입)
   */
  constructor(
    @InjectRepository(UpdateComment) private readonly comments: Repository<UpdateComment>,
    @InjectRepository(UpdateNote) private readonly notes: Repository<UpdateNote>,
    private readonly updates: UpdatesService,
  ) {}

  /**
   * 공개된 업데이트 노트의 댓글이면 사본(제목은 노트 제목)을 돌려준다.
   * @param id — 댓글 ID
   * @returns 사본 또는 null
   */
  async snapshot(id: string): Promise<ReportSnapshot | null> {
    if (!UUID_RE.test(id)) return null;
    const comment = await this.comments.findOne({ where: { id } });
    if (!comment) return null;
    const note = await this.notes.findOne({ where: { id: comment.updateId } });
    if (!note || !note.published) return null;
    return fit({
      title: note.title,
      content: comment.content,
      authorName: comment.authorName,
      link: `/updates/${note.id}`,
    });
  }

  /**
   * 댓글과 대댓글을 지운다.
   * @param id — 댓글 ID
   * @returns 지웠으면 true, 이미 없으면 false
   */
  remove(id: string): Promise<boolean> {
    return removeOrMissing(() => this.updates.adminDeleteComment(id));
  }
}

/**
 * 신고 대상 등록부 — 대상 종류로 처리 구현을 찾는다.
 * 새 대상을 붙일 때는 구현 클래스를 만들어 생성자 인자와 모듈 providers 에 추가한다.
 */
@Injectable()
export class ReportTargetRegistry {
  /** 대상 종류 → 처리 구현 */
  private readonly targets: Map<string, ReportTarget>;

  /**
   * @param post — 커뮤니티 글 처리 (DI 주입)
   * @param comment — 커뮤니티 댓글 처리 (DI 주입)
   * @param updateComment — 업데이트 댓글 처리 (DI 주입)
   */
  constructor(post: PostReportTarget, comment: CommentReportTarget, updateComment: UpdateCommentReportTarget) {
    this.targets = new Map<string, ReportTarget>([post, comment, updateComment].map((t) => [t.type, t]));
  }

  /**
   * 대상 종류의 처리 구현을 돌려준다.
   * @param type — 대상 종류
   * @returns 처리 구현
   * @throws BadRequestException — 등록되지 않은 종류
   */
  get(type: string): ReportTarget {
    const target = this.targets.get(type);
    if (!target) throw new BadRequestException("신고할 수 없는 대상입니다.");
    return target;
  }
}
