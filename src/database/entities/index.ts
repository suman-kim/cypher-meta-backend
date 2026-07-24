/**
 * 엔티티 인덱스 — 모든 TypeORM 엔티티를 한 곳에 모아 export 한다.
 * `entities` 배열은 app.module 의 TypeORM 설정(entities 옵션)에 그대로 주입되어
 * DataSource 가 스키마를 인식/동기화하는 데 사용된다.
 */
import { ApiCache } from "./api-cache.entity";
import { User } from "./user.entity";
import { FavoritePlayer } from "./favorite-player.entity";
import { SearchHistory } from "./search-history.entity";
import { Match } from "./match.entity";
import { MatchPlayer } from "./match-player.entity";
import { CollectionState } from "./collection-state.entity";
import { Post } from "./post.entity";
import { Comment } from "./comment.entity";
import { Visit } from "./visit.entity";
import { Vote } from "./vote.entity";
import { Costume } from "./costume.entity";
import { CostumeFeedback } from "./costume-feedback.entity";
import {CollectionConfig} from "./collection-config.entity";
import {CollectionRun} from "./collection-run.entity";

/** TypeORM DataSource 에 등록할 전체 엔티티 목록 (app.module 의 entities 옵션에 사용) */
export const entities = [
  ApiCache,
  User,
  FavoritePlayer,
  SearchHistory,
  Match,
  MatchPlayer,
  CollectionState,
  Post,
  Comment,
  Visit,
  Vote,
  Costume,
  CostumeFeedback,
  CollectionConfig,
  CollectionRun
];

// 개별 엔티티도 이름으로 재-export (레포지토리 주입 등에서 직접 import 용도)
export {
  ApiCache,
  User,
  FavoritePlayer,
  SearchHistory,
  Match,
  MatchPlayer,
  CollectionState,
  Post,
  Comment,
  Visit,
  Vote,
  Costume,
  CostumeFeedback,
  CollectionConfig,
  CollectionRun
};
