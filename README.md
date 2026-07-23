# Cyphers API (백엔드)

Cyphers 통계 플랫폼의 자체 백엔드. **NestJS + TypeORM + PostgreSQL**.
프론트(루트의 Next.js 앱)가 이 API를 호출하고, 이 서버가 Neople API 프록시·캐싱·계정·메타 집계·커뮤니티를 담당합니다.

## 빠른 시작

### 1. 데이터베이스 생성 (로컬 Postgres)
이미 설치된 Postgres에 DB만 만들면 됩니다.
```bash
createdb cyphers          # 또는  psql -c "CREATE DATABASE cyphers;"
```

### 2. 환경변수
```bash
cd backend
cp .env.example .env
```
`.env`에서 Postgres 접속 정보(`DB_USERNAME`/`DB_PASSWORD` 등)와 `NEOPLE_API_KEY`를 본인 환경에 맞게 수정하세요.
개발 중엔 `DB_SYNC=true` 로 두면 서버 실행 시 **엔티티대로 테이블이 자동 생성**됩니다.

### 3. 설치 & 실행
```bash
npm install
npm run start:dev        # http://localhost:4000/api
```

### 4. 동작 확인
```
GET http://localhost:4000/api          → { "name": "cyphers-api", "status": "ok" }
GET http://localhost:4000/api/health   → { "status": "ok", "db": "up" }   ← db:up 이면 DB 연결 성공
```

## 생성되는 스키마 (테이블 9개)

| 테이블 | 용도 |
|--------|------|
| `api_cache` | Neople 응답 캐시 (TTL) — 응답 캐싱 |
| `users` | 계정 |
| `favorite_players` | 즐겨찾기 플레이어 |
| `search_history` | 검색 기록 |
| `matches` | 수집한 매치 — 메타 집계 |
| `match_players` | 매치 내 플레이어 기록 — 픽률·승률·아이템 채택률 원천 |
| `collection_state` | 수집 파이프라인 진행 상태 |
| `posts` | 커뮤니티 게시글 |
| `comments` | 게시글 댓글 |

## 구조
```
backend/
├── src/
│   ├── main.ts               # 부트스트랩(CORS, /api 프리픽스, 검증 파이프)
│   ├── app.module.ts         # ConfigModule + TypeORM 연결
│   ├── health.controller.ts  # /api, /api/health
│   └── database/entities/    # 9개 엔티티(스키마)
├── .env.example
└── package.json
```

## 로드맵
- Phase 0 ✅ 스캐폴드 + 스키마 (현재)
- Phase 1 — Neople 프록시 + 응답 캐싱 (프론트가 백엔드 호출로 전환)
- Phase 2 — 계정/인증(JWT) + 즐겨찾기/검색기록
- Phase 3 — 메타 수집·집계 파이프라인 + /meta
- Phase 4 — 커뮤니티(게시판/댓글)

> ⚠️ 운영 배포 시엔 `DB_SYNC=false` 로 두고 마이그레이션을 사용하세요(추후 Phase에서 추가).
