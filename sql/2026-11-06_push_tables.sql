-- =====================================================================
-- 푸시 알림 테이블 2개 (push_devices, push_subscriptions) — 수동 마이그레이션
-- ---------------------------------------------------------------------
-- 모바일 앱 푸시 알림(전적 갱신·방송 시작)용. 엔티티:
--   src/database/entities/push-device.entity.ts
--   src/database/entities/push-subscription.entity.ts
-- 운영은 DB_SYNC=false 라 테이블이 자동으로 생기지 않으므로 배포 "전에" 이 SQL 을 한 번 실행한다.
--   로컬:  psql -U admin -d cyphers -f sql/2026-11-06_push_tables.sql
--   운영:  psql "$DATABASE_URL" -f sql/2026-11-06_push_tables.sql
-- 여러 번 실행해도 안전하다(IF NOT EXISTS / COMMENT 덮어쓰기). Postgres 13+ 와 CockroachDB 모두에서 돈다.
--  - 컬럼명은 TypeORM 기본(프로퍼티명 그대로, camelCase)이라 큰따옴표로 감싼다.
--  - 제약·인덱스 이름은 엔티티에 적은 이름과 같다(나중에 DB_SYNC 를 켜도 다시 만들지 않게).
--  - uuid 기본값은 확장 없이 쓰는 gen_random_uuid() (TypeORM 은 uuid_generate_v4() 와 같은 '자동 생성'으로 인식).
-- =====================================================================

-- 1) 알림을 받을 기기 ---------------------------------------------------
CREATE TABLE IF NOT EXISTS "push_devices" (
  "installId"  uuid                     NOT NULL,
  "token"      character varying(4096)  NOT NULL,
  "platform"   character varying(16)    NOT NULL,
  "createdAt"  timestamptz              NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz              NOT NULL DEFAULT now(),
  "lastSeenAt" timestamptz              NOT NULL DEFAULT now(),
  CONSTRAINT "PK_push_devices" PRIMARY KEY ("installId")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_push_devices_token" ON "push_devices" ("token");

COMMENT ON TABLE  "push_devices"               IS '푸시 알림을 받을 기기(앱 설치 1개당 1행)';
COMMENT ON COLUMN "push_devices"."installId"   IS '앱 설치 ID(UUID v4, 앱이 생성)';
COMMENT ON COLUMN "push_devices"."token"       IS 'FCM 등록 토큰(전체 유일)';
COMMENT ON COLUMN "push_devices"."platform"    IS '기기 플랫폼(android/ios)';
COMMENT ON COLUMN "push_devices"."createdAt"   IS '최초 등록 시각';
COMMENT ON COLUMN "push_devices"."updatedAt"   IS '레코드 갱신 시각';
COMMENT ON COLUMN "push_devices"."lastSeenAt"  IS '마지막 등록·구독 동기화 시각';

-- 2) 기기별 구독 대상 ---------------------------------------------------
--   kind='player' : targetId = Neople playerId(32자리 16진수)
--   kind='live'   : targetId = '플랫폼:채널ID' (chzzk | youtube | soop)
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id"          uuid                    NOT NULL DEFAULT gen_random_uuid(),
  "installId"   uuid                    NOT NULL,
  "kind"        character varying(16)   NOT NULL,
  "targetId"    character varying(160)  NOT NULL,
  "label"       character varying(100),
  "lastEventAt" timestamptz,
  "createdAt"   timestamptz             NOT NULL DEFAULT now(),
  CONSTRAINT "PK_push_subscriptions" PRIMARY KEY ("id"),
  CONSTRAINT "FK_push_subscriptions_installId" FOREIGN KEY ("installId")
    REFERENCES "push_devices" ("installId") ON DELETE CASCADE
);

-- 기기별 조회도 이 인덱스(installId 로 시작)가 맡는다.
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_push_subscriptions_target"
  ON "push_subscriptions" ("installId", "kind", "targetId");
-- 감지 작업용: 종류별 구독 대상 목록·특정 대상의 구독자 찾기
CREATE INDEX IF NOT EXISTS "IDX_push_subscriptions_kind_target"
  ON "push_subscriptions" ("kind", "targetId");

COMMENT ON TABLE  "push_subscriptions"                IS '기기별 푸시 알림 구독 대상(전적 갱신·방송 시작)';
COMMENT ON COLUMN "push_subscriptions"."id"           IS '구독 행 ID(UUID)';
COMMENT ON COLUMN "push_subscriptions"."installId"    IS '구독한 기기 설치 ID(push_devices.installId)';
COMMENT ON COLUMN "push_subscriptions"."kind"         IS '구독 종류(player=전적 갱신 / live=방송 시작)';
COMMENT ON COLUMN "push_subscriptions"."targetId"     IS '구독 대상 ID(player: playerId / live: 플랫폼:채널ID)';
COMMENT ON COLUMN "push_subscriptions"."label"        IS '표시명 스냅샷(닉네임/채널명)';
COMMENT ON COLUMN "push_subscriptions"."lastEventAt"  IS '(player 전용) 마지막으로 반영한 경기 시각, null=기준점 없음';
COMMENT ON COLUMN "push_subscriptions"."createdAt"    IS '구독 등록 시각';
