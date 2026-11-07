/**
 * activity-sources.ts — 관리자 '활동' 화면에 모아 보여 줄 출처들.
 * 글·댓글·업데이트 댓글·신고·투표·코스튬 제보·앱 알림 기기 등록. 새 출처는 SqlActivitySource 를 상속해 만들고
 * ActivityService 의 목록에 한 줄 더한다.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { previewText } from "../analytics-logic";
import { ActivityLine, SqlActivitySource } from "./activity-source";

/** 신고 사유 키 → 이름(프론트 moderation-core 의 REPORT_REASONS 와 같은 이름) */
const REPORT_REASON_LABELS: Record<string, string> = {
  abuse: "욕설·비방",
  spam: "스팸·광고",
  sexual: "음란물",
  illegal: "불법 정보",
  privacy: "개인정보 노출",
  other: "기타",
};
/** 신고 대상 종류 → 이름 */
const REPORT_TARGET_LABELS: Record<string, string> = {
  post: "글",
  comment: "댓글",
  update_comment: "업데이트 댓글",
};
/** 투표 종류 → 이름과 화면 경로 */
const VOTE_KINDS: Record<string, { label: string; link: string }> = {
  tier: { label: "캐릭터 티어 투표(역할별)", link: "/meta" },
  tier_official: { label: "캐릭터 티어 투표(공식 역할군)", link: "/meta" },
  comp: { label: "조합 투표", link: "/meta/comp" },
  comp_official: { label: "조합 투표(공식)", link: "/meta/comp" },
};
/** 기기 플랫폼 → 이름 */
const PLATFORM_LABELS: Record<string, string> = { android: "안드로이드", ios: "아이폰" };

/** 커뮤니티 글 작성 */
export class PostActivity extends SqlActivitySource {
  readonly type = "post";
  readonly label = "글";
  protected readonly fromSql = "posts p";
  protected readonly timeSql = `p."createdAt"`;
  protected readonly idSql = "p.id";
  protected readonly columnsSql = `p.title, p.content, p."boardType", p."isNotice", p."authorName"`;

  /** @param row — 글 행 */
  protected toLine(row: Record<string, any>): ActivityLine {
    return {
      title: `${row.isNotice ? "[공지] " : ""}${row.title}`,
      detail: previewText(row.content, 80),
      actor: row.authorName ?? null,
      link: `/community/${row.boardType}/${row._id}`,
    };
  }
}

/** 커뮤니티 댓글·답글 작성 */
export class CommentActivity extends SqlActivitySource {
  readonly type = "comment";
  readonly label = "댓글";
  protected readonly fromSql = `comments c LEFT JOIN posts p ON p.id = c."postId"`;
  protected readonly timeSql = `c."createdAt"`;
  protected readonly idSql = "c.id";
  protected readonly columnsSql = `c.content, c."authorName", c."parentId", c."postId", p.title AS "postTitle", p."boardType"`;

  /** @param row — 댓글 행(글 제목 포함) */
  protected toLine(row: Record<string, any>): ActivityLine {
    const kind = row.parentId ? "답글" : "댓글";
    return {
      title: previewText(row.content, 80) ?? "(내용 없음)",
      detail: row.postTitle ? `'${previewText(row.postTitle, 40)}'에 단 ${kind}` : `지워진 글에 단 ${kind}`,
      actor: row.authorName ?? null,
      link: row.boardType ? `/community/${row.boardType}/${row.postId}` : null,
    };
  }
}

/** 업데이트 노트 댓글·답글 작성 */
export class UpdateCommentActivity extends SqlActivitySource {
  readonly type = "update_comment";
  readonly label = "업데이트 댓글";
  protected readonly fromSql = `update_comments c LEFT JOIN update_notes n ON n.id = c."updateId"`;
  protected readonly timeSql = `c."createdAt"`;
  protected readonly idSql = "c.id";
  protected readonly columnsSql = `c.content, c."authorName", c."parentId", c."updateId", n.title AS "noteTitle"`;

  /** @param row — 업데이트 댓글 행(노트 제목 포함) */
  protected toLine(row: Record<string, any>): ActivityLine {
    const kind = row.parentId ? "답글" : "댓글";
    return {
      title: previewText(row.content, 80) ?? "(내용 없음)",
      detail: row.noteTitle ? `업데이트 '${previewText(row.noteTitle, 40)}'에 단 ${kind}` : `지워진 업데이트에 단 ${kind}`,
      actor: row.authorName ?? null,
      link: `/updates/${row.updateId}`,
    };
  }
}

/** 신고 접수 */
export class ReportActivity extends SqlActivitySource {
  readonly type = "report";
  readonly label = "신고";
  protected readonly fromSql = "content_reports r";
  protected readonly timeSql = `r."createdAt"`;
  protected readonly idSql = "r.id";
  protected readonly columnsSql = `r.reason, r."targetType", r.detail, r.status, r."snapshotTitle", r."snapshotContent", r."snapshotAuthor", r."targetLink"`;

  /** @param row — 신고 행 */
  protected toLine(row: Record<string, any>): ActivityLine {
    const reason = REPORT_REASON_LABELS[row.reason] ?? row.reason;
    const target = REPORT_TARGET_LABELS[row.targetType] ?? row.targetType;
    // 글 신고는 글 제목, 댓글 신고는 댓글 내용(댓글 사본의 제목 칸에는 글 제목이 들어 있다)
    const what =
      (row.targetType === "post" ? previewText(row.snapshotTitle, 40) : null) ??
      previewText(row.snapshotContent, 40) ??
      "";
    const parts = [
      `${target}${row.snapshotAuthor ? ` · 작성자 ${row.snapshotAuthor}` : ""}`,
      row.detail ? `신고 내용: ${previewText(row.detail, 60)}` : null,
      row.status === "pending" ? "처리 대기" : "처리됨",
    ].filter(Boolean);
    return {
      title: `[${reason}] ${what}`.trim(),
      detail: parts.join(" · "),
      actor: null,
      link: row.targetLink ?? null,
    };
  }
}

/** 투표(처음 투표·다시 투표) — 다시 투표하면 같은 행이 갱신되므로 갱신 시각 기준 */
export class VoteActivity extends SqlActivitySource {
  readonly type = "vote";
  readonly label = "투표";
  protected readonly fromSql = "votes v";
  protected readonly timeSql = `v."updatedAt"`;
  protected readonly idSql = "v.id";
  protected readonly columnsSql = `v.kind, (v."updatedAt" - v."createdAt") > interval '1 second' AS "changed"`;

  /** @param row — 투표 행 */
  protected toLine(row: Record<string, any>): ActivityLine {
    const kind = VOTE_KINDS[row.kind];
    return {
      title: kind?.label ?? `투표(${row.kind})`,
      detail: row.changed ? "투표를 바꿨어요" : "처음 투표했어요",
      actor: null,
      link: kind?.link ?? null,
    };
  }
}

/** 코스튬 시세 신고·수정 요청 */
export class CostumeFeedbackActivity extends SqlActivitySource {
  readonly type = "costume_feedback";
  readonly label = "코스튬 제보";
  protected readonly fromSql = `costume_feedback f LEFT JOIN costumes c ON c.id = f."costumeId"`;
  protected readonly timeSql = `f."createdAt"`;
  protected readonly idSql = "f.id";
  protected readonly columnsSql = `f.kind, f.price, f."priceUnit", f.field, f.content, f."authorName", c."characterName", c."costumeName"`;

  /** @param row — 코스튬 제보 행(코스튬 이름 포함) */
  protected toLine(row: Record<string, any>): ActivityLine {
    const name = row.characterName ? `${row.characterName} · ${row.costumeName}` : "지워진 코스튬";
    const memo = previewText(row.content, 60);
    const detail =
      row.kind === "price"
        ? `시세 신고 ${row.price ?? "-"}${row.priceUnit ?? ""}${memo ? ` · ${memo}` : ""}`
        : `수정 요청${row.field ? `(${row.field})` : ""}${memo ? `: ${memo}` : ""}`;
    return { title: name, detail, actor: row.authorName ?? null, link: "/costumes" };
  }
}

/** 앱 알림 기기 등록(앱 설치 후 처음 알림을 켬) */
export class PushDeviceActivity extends SqlActivitySource {
  readonly type = "push_device";
  readonly label = "알림 기기";
  protected readonly fromSql = "push_devices d";
  protected readonly timeSql = `d."createdAt"`;
  protected readonly idSql = `d."installId"`;
  protected readonly columnsSql = `d.platform`;

  /** @param row — 알림 기기 행 */
  protected toLine(row: Record<string, any>): ActivityLine {
    return {
      title: `${PLATFORM_LABELS[row.platform] ?? row.platform} 기기에서 알림 등록`,
      detail: null,
      actor: null,
      link: null,
    };
  }
}
