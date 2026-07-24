/**
 * 캐릭터 역할(포지션) 분류표.
 *
 * Neople 사이퍼즈 오픈 API 는 캐릭터의 포지션(탱커/근접딜러/원거리딜러/서포터)을
 * 제공하지 않으므로, 여기서 정적으로 관리한다. (게임 고정 데이터라 변동이 드묾)
 *   - 분류 출처: namu.wiki 각 캐릭터 문서의 '추천 포지션' 인포박스
 *   - 신규 캐릭터/오분류는 이 표만 수정하면 전체 통계에 즉시 반영된다.
 *
 * key = characterName (match_players.characterName 과 조인), value = 역할 코드.
 */

/**
 * 캐릭터 역할 코드.
 * - "tank": 탱커
 * - "melee": 근접딜러
 * - "ranged": 원거리딜러
 * - "support": 서포터
 */
export type CharacterRole = "tank" | "melee" | "ranged" | "support";
/**
 * 역할 코드 + 미분류("etc"). 분류표에 없는 캐릭터를 표현할 때 사용.
 */
export type RoleOrEtc = CharacterRole | "etc";

/**
 * 캐릭터 이름 → 역할 코드 매핑표.
 * 키는 캐릭터 이름(match_players.characterName 과 동일한 한글 표기),
 * 값은 해당 캐릭터의 포지션 역할 코드(tank/melee/ranged/support)이다.
 * 표에 없는 이름은 classifyRole 에서 "etc"(미분류)로 처리된다.
 */
export const ROLE_BY_NAME: Record<string, CharacterRole> = {
  로라스: "melee",
  휴톤: "tank",
  루이스: "melee",
  타라: "ranged",
  트리비아: "ranged",
  카인: "ranged",
  레나: "tank",
  드렉슬러: "ranged",
  도일: "tank",
  토마스: "support",
  나이오비: "ranged",
  시바: "melee",
  웨슬리: "ranged",
  스텔라: "tank",
  앨리셔: "support",
  클레어: "ranged",
  다이무스: "melee",
  이글: "melee",
  마를렌: "ranged",
  샬럿: "support",
  윌라드: "ranged",
  레이튼: "tank",
  미쉘: "ranged",
  린: "tank",
  빅터: "ranged",
  카를로스: "melee",
  호타루: "melee",
  트릭시: "melee",
  히카르도: "melee",
  까미유: "support",
  자네트: "melee",
  피터: "ranged",
  아이작: "tank",
  레베카: "tank",
  엘리: "ranged",
  마틴: "support",
  브루스: "tank",
  미아: "ranged",
  드니스: "ranged",
  제레온: "melee",
  루시: "ranged",
  티엔: "tank",
  하랑: "ranged",
  제이: "melee",
  벨져: "tank",
  리첼: "tank",
  리사: "support",
  릭: "support",
  제키엘: "tank",
  탄야: "ranged",
  캐럴: "support",
  라이샌더: "melee",
  루드빅: "melee",
  멜빈: "ranged",
  디아나: "tank",
  클리브: "melee",
  헬레나: "ranged",
  에바: "tank",
  론: "ranged",
  레오노르: "tank",
  시드니: "support",
  테이: "melee",
  티모시: "tank",
  엘프리데: "ranged",
  티샤: "support",
  카로슈: "melee",
  라이언: "tank",
  "파수꾼 A": "ranged",
  에밀리: "support",
  플로리안: "tank",
  케니스: "melee",
  이사벨: "ranged",
  헤나투: "support",
  숙희: "tank",
  그레타: "melee",
  바스티안: "ranged",
  재뉴어리: "support",
  니콜라스: "tank",
  키아라: "melee",
  베로니카: "ranged",
  주세페: "support",
  루카: "melee",
  "앤지 헌트": "ranged",
  엔데카: "tank",
  오데트: "support",
};

/**
 * 역할 코드 → 한글 표시 라벨 매핑.
 * UI/통계 출력에서 코드를 사람이 읽을 수 있는 이름으로 변환할 때 사용한다.
 * - tank → "탱커", melee → "근접딜러", ranged → "원거리딜러",
 *   support → "서포터", etc → "미분류".
 */
export const ROLE_LABELS: Record<RoleOrEtc, string> = {
  tank: "탱커",
  melee: "근접딜러",
  ranged: "원거리딜러",
  support: "서포터",
  etc: "미분류",
};

/**
 * 캐릭터 이름으로 역할 코드를 판별한다.
 * @param characterName — 캐릭터 이름 (null/undefined 이거나 표에 없으면 "etc").
 * @returns ROLE_BY_NAME 에 매핑된 역할 코드, 없으면 "etc"(미분류).
 */
export function classifyRole(characterName?: string | null): RoleOrEtc {
  if (!characterName) return "etc";
  return ROLE_BY_NAME[characterName] ?? "etc";
}
