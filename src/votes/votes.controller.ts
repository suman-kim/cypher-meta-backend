/**
 * votes.controller.ts
 * ------------------------------------------------------------------
 * 사용자 투표(캐릭터 티어 / 조합 티어) HTTP 컨트롤러.
 * `/votes` 하위 REST 엔드포인트를 정의한다.
 *  - tier: 역할별 최고 캐릭터 1명 투표(저장/집계/내 투표 조회).
 *  - comp: 편성 조합 투표(저장/집계/내 투표 조회).
 *  - official/*: 공식 역할군 체계 투표(선택 단위 = 캐릭터:궁극기). 기존 tier/comp 는 legacy 로 유지.
 * 방문자 식별은 로그인 없이 visitorId(클라이언트가 생성한 식별자)로 처리하며,
 * 실제 집계·저장 로직은 VotesService 로 위임한다.
 * ------------------------------------------------------------------
 */
import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { VotesService } from "./votes.service";
import { OfficialCompVoteBody, OfficialTierVoteBody } from "./dto";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 투표 컨트롤러.
 * 라우트 프리픽스 `/votes` 아래의 티어/조합 투표 엔드포인트를 처리한다.
 */
@Controller("votes")
export class VotesController {
  /**
   * @param votes — 투표 저장/집계 로직을 담당하는 VotesService (DI 주입)
   */
  constructor(private readonly votes: VotesService) {}

  /**
   * 캐릭터 티어 투표 저장/갱신.
   * 라우트: POST /votes/tier
   * @param body — 요청 본문. visitorId(방문자 식별자)와 picks(역할별 선택 캐릭터 맵)를 포함
   * @returns 저장 결과({ ok, picks })
   */
  @Post("tier")
  saveTier(@Body() body: any) {
    return this.votes.saveTier(body?.visitorId, body?.picks);
  }

  /**
   * 캐릭터 티어 투표 집계 결과 조회(역할별 상위 캐릭터).
   * 라우트: GET /votes/tier
   * @returns 전체 투표 수와 역할별 상위 캐릭터 집계
   */
  @Get("tier")
  getTier() {
    return this.votes.getTier();
  }

  /**
   * 특정 방문자의 캐릭터 티어 투표 조회.
   * 라우트: GET /votes/tier/mine
   * @param visitorId — 방문자 식별자(쿼리 파라미터)
   * @returns 해당 방문자의 선택({ picks })
   */
  @Get("tier/mine")
  tierMine(@Query("visitorId") visitorId: string) {
    return this.votes.getTierMine(visitorId);
  }

  /**
   * 조합(편성) 티어 투표 저장/갱신.
   * 라우트: POST /votes/comp
   * @param body — 요청 본문. visitorId, formationKey(편성 키), ids(슬롯별 캐릭터 id 배열)를 포함
   * @returns 저장 결과({ ok, formationKey, ids })
   */
  @Post("comp")
  saveComp(@Body() body: any) {
    return this.votes.saveComp(body?.visitorId, body?.formationKey, body?.ids);
  }

  /**
   * 조합 투표 집계 결과 조회(인기 조합 상위).
   * 라우트: GET /votes/comp
   * @returns 전체 투표 수·고유 조합 수·상위 조합 목록
   */
  @Get("comp")
  getComp() {
    return this.votes.getComp();
  }

  /**
   * 특정 방문자의 조합 투표 조회.
   * 라우트: GET /votes/comp/mine
   * @param visitorId — 방문자 식별자(쿼리 파라미터)
   * @returns 해당 방문자의 조합({ comp })
   */
  @Get("comp/mine")
  compMine(@Query("visitorId") visitorId: string) {
    return this.votes.getCompMine(visitorId);
  }

  /* ---- 공식 역할군 체계 (/votes/official/*) ---- */

  /**
   * 공식 역할군 편성 프리셋 목록. 라우트: GET /votes/official/formations
   * @returns [{ key, label, roles }] — 조합 투표 편성 선택지
   */
  @Get("official/formations")
  officialFormations() {
    return this.votes.getOfficialFormations();
  }

  /**
   * 공식 역할군 티어 투표 저장/갱신. 라우트: POST /votes/official/tier
   * @param body — visitorId, picks(역할군 키 → "캐릭터ID:궁극기")
   * @returns 저장 결과({ ok, picks }) — 역할군이 맞지 않는 선택은 제외됨
   */
  @Post("official/tier")
  saveTierOfficial(@Body() body: OfficialTierVoteBody) {
    return this.votes.saveTierOfficial(body.visitorId, body.picks);
  }

  /**
   * 공식 역할군 티어 투표 집계. 라우트: GET /votes/official/tier
   * @returns 전체 투표 수와 역할군별 상위 "캐릭터(1차/2차)"
   */
  @Get("official/tier")
  getTierOfficial() {
    return this.votes.getTierOfficial();
  }

  /**
   * 내 공식 역할군 티어 투표. 라우트: GET /votes/official/tier/mine?visitorId=
   * @param visitorId — 방문자 식별자
   * @returns { picks }
   */
  @Get("official/tier/mine")
  tierOfficialMine(@Query("visitorId") visitorId: string) {
    return this.votes.getTierOfficialMine(visitorId);
  }

  /**
   * 공식 역할군 조합 투표 저장/갱신. 라우트: POST /votes/official/comp
   * @param body — visitorId, formationKey(공식 편성 key), units(슬롯별 "캐릭터ID:궁극기")
   * @returns 저장 결과({ ok, formationKey, units })
   */
  @Post("official/comp")
  saveCompOfficial(@Body() body: OfficialCompVoteBody) {
    return this.votes.saveCompOfficial(body.visitorId, body.formationKey, body.units);
  }

  /**
   * 공식 역할군 조합 투표 집계. 라우트: GET /votes/official/comp
   * @returns 전체 투표 수·고유 조합 수·상위 조합
   */
  @Get("official/comp")
  getCompOfficial() {
    return this.votes.getCompOfficial();
  }

  /**
   * 내 공식 역할군 조합 투표. 라우트: GET /votes/official/comp/mine?visitorId=
   * @param visitorId — 방문자 식별자
   * @returns { comp }
   */
  @Get("official/comp/mine")
  compOfficialMine(@Query("visitorId") visitorId: string) {
    return this.votes.getCompOfficialMine(visitorId);
  }
}
