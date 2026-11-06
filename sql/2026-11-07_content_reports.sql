-- =====================================================================
-- 사용자 신고 테이블 (content_reports) — 수동 마이그레이션
-- ---------------------------------------------------------------------
-- 커뮤니티 글·댓글, 업데이트 노트 댓글 신고(Google Play 사용자 제작 콘텐츠 정책 대응). 엔티티:
--   src/database/entities/content-report.entity.ts
-- 운영은 DB_SYNC=false 라 테이블이 자동으로 생기지 않으므로 백엔드 배포 "전에" 이 SQL 을 한 번 실행한다.
--   로컬:  psql -U admin -d cyphers -f sql/2026-11-07_content_reports.sql
--   운영:  psql "$DATABASE_URL" -f sql/2026-11-07_content_reports.sql
-- 여러 번 실행해도 안전하다(IF NOT EXISTS / COMMENT 덮어쓰기). Postgres 13+ 와 CockroachDB 모두에서 돈다.
--  - 컬럼명은 TypeORM 기본(프로퍼티명 그대로, camelCase)이라 큰따옴표로 감싼다.
--  - 제약·인덱스 이름은 엔티티에 적은 이름과 같다(나중에 DB_SYNC 를 켜도 다시 만들지 않게).
-- =====================================================================

CREATE TABLE IF NOT EXISTS "content_reports" (
  "id"              uuid                    NOT NULL DEFAULT gen_random_uuid(),
  "targetType"      character varying(20)   NOT NULL,
  "targetId"        character varying(64)   NOT NULL,
  "reason"          character varying(20)   NOT NULL,
  "detail"          text,
  "reporterHash"    character varying(64)   NOT NULL,
  "status"          character varying(16)   NOT NULL DEFAULT 'pending',
  "snapshotTitle"   character varying(200),
  "snapshotContent" text                    NOT NULL,
  "snapshotAuthor"  character varying(40),
  "targetLink"      character varying(300),
  "createdAt"       timestamptz             NOT NULL DEFAULT now(),
  "handledAt"       timestamptz,
  CONSTRAINT "PK_content_reports" PRIMARY KEY ("id")
);

-- 같은 사람이 같은 대상을 두 번 신고하지 못하게(대상별 묶음·처리 조회도 이 인덱스가 맡는다)
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_content_reports_reporter"
  ON "content_reports" ("targetType", "targetId", "reporterHash");
-- 관리자 목록: 상태별 최신순
CREATE INDEX IF NOT EXISTS "IDX_content_reports_status"
  ON "content_reports" ("status", "createdAt");

COMMENT ON TABLE  "content_reports"                   IS '사용자 신고(커뮤니티 글·댓글, 업데이트 댓글)';
COMMENT ON COLUMN "content_reports"."id"              IS '신고 ID';
COMMENT ON COLUMN "content_reports"."targetType"      IS '신고 대상 종류(post/comment/update_comment)';
COMMENT ON COLUMN "content_reports"."targetId"        IS '신고 대상 ID(posts.id / comments.id / update_comments.id, 문자열)';
COMMENT ON COLUMN "content_reports"."reason"          IS '신고 사유(spam/abuse/sexual/illegal/privacy/other)';
COMMENT ON COLUMN "content_reports"."detail"          IS '상세 설명(선택)';
COMMENT ON COLUMN "content_reports"."reporterHash"    IS '신고자 임의 ID 의 SHA-256 해시(중복 신고 방지)';
COMMENT ON COLUMN "content_reports"."status"          IS '처리 상태(pending/deleted/dismissed)';
COMMENT ON COLUMN "content_reports"."snapshotTitle"   IS '신고 당시 제목 사본';
COMMENT ON COLUMN "content_reports"."snapshotContent" IS '신고 당시 본문 사본(최대 2000자)';
COMMENT ON COLUMN "content_reports"."snapshotAuthor"  IS '신고 당시 작성자 닉네임 사본';
COMMENT ON COLUMN "content_reports"."targetLink"      IS '대상 화면 경로';
COMMENT ON COLUMN "content_reports"."createdAt"       IS '신고 시각';
COMMENT ON COLUMN "content_reports"."handledAt"       IS '처리 시각(대기 중 null)';
