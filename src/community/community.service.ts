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

  async onModuleInit() {
    try {
      const count = await this.posts.count();
      if (count === 0) {
        await this.seed();
        this.logger.log("커뮤니티 샘플 데이터를 시드했습니다.");
      }
    } catch (e) {
      // DB 미연결/미동기화 등은 앱 부팅을 막지 않도록 경고만 남김
      this.logger.warn(`커뮤니티 시드 스킵: ${(e as Error).message}`);
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

  /* ------------------------------------------------------------------ */
  /* 최초 실행 시 샘플 데이터 시드 (posts 테이블이 비어있을 때만)         */
  /* ------------------------------------------------------------------ */
  private async seed() {
    const pw = hashPassword("0000");
    const mk = (o: Partial<Post>): Post => this.posts.create({ guestPassword: pw, ...o });

    // 1) 공지 — 우측 사이드바(공지사항) + 자유게시판 상단 고정
    await this.posts.save([
      mk({
        boardType: "notice",
        isNotice: true,
        title: "1/25 정기점검 안내",
        content: "1월 25일 오전 6시부터 10시까지 정기점검이 진행됩니다. 점검 중 접속이 제한됩니다.",
        authorName: "운영진",
        views: 8200,
      }),
      mk({
        boardType: "notice",
        isNotice: true,
        title: "신규 코스튬 '윈터 아우라' 출시",
        content: "겨울 시즌 한정 코스튬 '윈터 아우라'가 상점에 추가되었습니다.",
        authorName: "운영진",
        views: 12400,
      }),
      mk({
        boardType: "notice",
        isNotice: true,
        title: "불법 프로그램 사용 제한 안내",
        content: "공정한 플레이 환경을 위해 불법 프로그램 사용 계정에 대한 제재를 강화합니다.",
        authorName: "운영진",
        views: 5300,
      }),
      mk({
        boardType: "free",
        isNotice: true,
        title: "커뮤니티 이용 규칙 안내 (24.01.01 개정)",
        content:
          "커뮤니티 이용 규칙이 개정되었습니다. 상호 존중, 도배/욕설/광고 금지 등 기본 규칙을 지켜주세요.",
        authorName: "운영진",
        views: 24000,
      }),
    ]);

    // 2) 자유게시판 일반 글
    const freeSeed: Partial<Post>[] = [
      {
        category: "discussion",
        title: "오늘자 릭 너프 체감 실화냐",
        content: "진짜 텔레포트 쿨타임 증가한 게 너무 크다. 이제 도주하기도 힘들고 초반 갱킹도 애매해짐.",
        authorName: "릭장인",
        views: 5600,
        likes: 156,
      },
      {
        category: "info",
        title: "신캐 사이드 스토리 텍스트 정리해봤습니다",
        content: "이번에 나온 신캐릭터 텍스트들 다 긁어서 정리했습니다. 세계관 좋아하시는 분들 참고하세요.",
        authorName: "스토리중",
        views: 3400,
        likes: 89,
      },
      {
        category: "info",
        title: "그랑플람 재단 맵 리뉴얼 소식",
        content: "개발자 노트 보니까 맵 전체적으로 텍스처 업그레이드 한다고 하네요. 스샷 첨부합니다.",
        authorName: "맵박사",
        views: 2200,
        likes: 64,
      },
      {
        category: "free",
        title: "방금 판 우리 팀 타라 미쳤나요? 진짜 답 없네",
        content: "라인전부터 계속 다이브 당하는데 백업도 안 오고… 그냥 멘탈 나가서 글 씁니다.",
        authorName: "타라장인88",
        views: 1245,
        likes: 15,
      },
      {
        category: "question",
        title: "복귀 유저인데 요즘 메타가 어떻게 되나요?",
        content: "한 2년 쉬다 왔는데 요즘 티어권 캐릭이랑 아이템 트리 좀 알려주실 수 있나요?",
        authorName: "새벽의전령",
        views: 3512,
        likes: 8,
      },
      {
        category: "info",
        title: "공홈 매거진 떴음 신캐 일러 대박임 ㄷㄷ",
        content: "공식 홈페이지 매거진 업데이트됐는데 신캐 일러스트 퀄리티가 미쳤습니다. 링크 참고.",
        authorName: "정보봇",
        views: 15000,
        likes: 241,
      },
      {
        category: "discussion",
        title: "탱커 상향이 시급합니다 진짜",
        content: "지금 메타에서 탱커가 너무 약함. 유지력도 딜러한테 밀리고 라인 유지도 안 됨.",
        authorName: "방어의정석",
        views: 4201,
        likes: 34,
      },
      {
        category: "info",
        title: "PC방 이벤트 누적 보상 다 받음 인증",
        content: "PC방에서 누적 시간 채우고 보상 전부 수령했습니다. 코스튬 교환권까지 알뜰하게 챙김.",
        authorName: "겜창인생",
        views: 2100,
        likes: 12,
      },
      {
        category: "free",
        title: "클랜원 모집합니다 (성인/디코필수)",
        content: "저녁 시간대 같이 플레이할 성인 클랜원 구합니다. 디스코드 필수, 매너 게임 지향합니다.",
        authorName: "클랜장임",
        views: 892,
        likes: 3,
      },
      {
        category: "free",
        title: "님들 이거 버그 아님? 방금 데미지 표기가 이상함",
        content: "스킬 데미지 표기랑 실제 들어가는 딜이 다른 것 같은데 저만 그런가요? 클립 첨부합니다.",
        authorName: "의문의사나이",
        views: 3120,
        likes: 11,
      },
    ];

    // 페이지네이션 확인용 추가 글
    const filler: Partial<Post>[] = Array.from({ length: 8 }, (_, i) => ({
      category: (["free", "question", "info", "discussion"] as const)[i % 4],
      title: `[잡담] 오늘 랭크 소감 남기고 갑니다 #${i + 1}`,
      content: "오늘 랭크 돌린 후기 간단히 남깁니다. 승률은 반반인데 그래도 재밌었네요.",
      authorName: `랜덤유저${100 + i}`,
      views: 300 + i * 137,
      likes: i * 2,
    }));

    const savedFree = await this.posts.save(
      [...freeSeed, ...filler].map((o) => mk({ boardType: "free", ...o })),
    );

    // 3) 다른 게시판 글 (비어있지 않도록)
    await this.posts.save([
      mk({
        boardType: "guide",
        category: "info",
        title: "[궁극의 가이드] 탱커 캐릭터 상대하는 법 총정리",
        content: "포지션별로 탱커를 상대하는 법을 정리했습니다. 스킬 순서와 아이템 카운터 위주로 설명합니다.",
        authorName: "공략가",
        views: 4800,
        likes: 132,
      }),
      mk({
        boardType: "guide",
        category: "info",
        title: "신규 유저를 위한 포지션별 캐릭터 추천",
        content: "입문자에게 추천하는 포지션별 쉬운 캐릭터를 정리했습니다.",
        authorName: "친절한멘토",
        views: 3100,
        likes: 77,
      }),
      mk({
        boardType: "humor",
        category: "free",
        title: "우리가 이길 때 vs 질 때 팀원들 채팅.jpg",
        content: "이길 때랑 질 때 팀 채팅 온도차 실화냐 ㅋㅋㅋㅋ 공감 가시는 분?",
        authorName: "짤줍는사람",
        views: 9800,
        likes: 312,
      }),
      mk({
        boardType: "video",
        category: "free",
        title: "그랜드마스터 랭킹 1위 하이라이트 - 4주차",
        content: "이번 주 랭킹 1위 유저의 하이라이트 영상입니다. 무빙이 예술이네요.",
        authorName: "하이라이터",
        views: 6400,
        likes: 158,
      }),
    ]);

    // 4) 상위 글 몇 개에 댓글 시드 (commentCount 와 일치)
    const commentSeed: Record<string, string[]> = {
      "오늘자 릭 너프 체감 실화냐": [
        "ㄹㅇ 텔포 쿨 늘어난 거 너무 큼",
        "그래도 아직 초반 라인전은 셈",
        "너프 먹을 만했지 그동안 너무 사기였음",
        "이제 그만 좀 너프해라 ㅠㅠ",
      ],
      "탱커 상향이 시급합니다 진짜": [
        "인정합니다 요즘 탱커 픽하기 무섭",
        "유지력 아이템이라도 하나 줬으면",
        "밸런스팀 이 글 봐주세요",
      ],
      "공홈 매거진 떴음 신캐 일러 대박임 ㄷㄷ": [
        "일러 진짜 잘 뽑았더라",
        "성능도 저 정도면 좋겠다",
      ],
    };

    for (const post of savedFree) {
      const texts = commentSeed[post.title];
      if (!texts) continue;
      const rows = texts.map((content, i) =>
        this.comments.create({
          postId: post.id,
          authorName: `댓글러${i + 1}`,
          guestPassword: pw,
          content,
        }),
      );
      await this.comments.save(rows);
      await this.posts.update({ id: post.id }, { commentCount: rows.length });
    }
  }
}
