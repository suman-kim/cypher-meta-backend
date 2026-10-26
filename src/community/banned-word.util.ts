/**
 * banned-word.util.ts
 * ------------------------------------------------------------------
 * 금칙어 비교용 순수 함수(정규화·매칭). DB·Nest 의존이 없어 단독으로 검증할 수 있다.
 *
 * 정규화 규칙 — "씨.발", "씨~발", "씨 발", "ＦＵＣＫ" 같은 우회 표기를 잡기 위함:
 *  - 한글(음절·자모)·영문·숫자만 남기고 기호·이모지는 지운다. 영문은 소문자, 전각 영숫자는 반각으로.
 *  - 공백은 단어 경계로 남기되, 경계 양쪽 중 한쪽이라도 1글자 토큰이면 붙인다("씨 발" → "씨발").
 *    공백을 전부 지우면 "김씨 발언" → "김씨발언" 처럼 멀쩡한 문장이 걸리기 때문이다.
 *  - 정규화 문자열의 각 글자가 원문 어디서 왔는지(starts/ends)를 같이 기록해,
 *    걸린 부분을 원문 위치로 돌려준다(화면에서 원문 그대로 강조 표시).
 * ------------------------------------------------------------------
 */

/** 정규화 결과 — text[k] 는 원문 [starts[k], ends[k]) 구간에서 왔다 */
export interface NormalizedText {
  text: string;
  starts: number[];
  ends: number[];
}

/** 금칙어 검사 결과 1건 — 원문 기준 위치와 걸린 원문 조각 */
export interface BannedMatch {
  /** 검사한 입력 필드 키(title / content / guestName) */
  field: string;
  /** 걸린 금칙어(관리자가 등록한 원문) */
  word: string;
  /** 원문 시작 위치(UTF-16 인덱스, 포함) */
  start: number;
  /** 원문 끝 위치(UTF-16 인덱스, 미포함) */
  end: number;
  /** 원문에서 걸린 부분 그대로(예: "씨.발") */
  text: string;
}

/** 비교 대상 금칙어(원문 + 정규화 형태) */
export interface BannedWordEntry {
  word: string;
  norm: string;
}

/**
 * 글자 하나를 비교용 글자로 바꾼다.
 * @param ch — 원문 글자(코드포인트 1개)
 * @returns 남길 글자(소문자·반각), 버릴 글자(기호·이모지 등)면 null
 */
function foldChar(ch: string): string | null {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp >= 0xac00 && cp <= 0xd7a3) return ch; // 한글 음절
  if (cp >= 0x3131 && cp <= 0x318e) return ch; // 호환용 자모(ㅅㅂ 등)
  if (cp >= 0x1100 && cp <= 0x11ff) return ch; // 첫가끝 자모
  if (cp >= 0x30 && cp <= 0x39) return ch; // 숫자
  if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) return ch.toLowerCase();
  // 전각 숫자·영문(０-９, Ａ-Ｚ, ａ-ｚ) → 반각
  if ((cp >= 0xff10 && cp <= 0xff19) || (cp >= 0xff21 && cp <= 0xff3a) || (cp >= 0xff41 && cp <= 0xff5a)) {
    return String.fromCharCode(cp - 0xfee0).toLowerCase();
  }
  return null;
}

/**
 * 문자열을 비교용으로 정규화하면서 원문 위치 대응표를 만든다.
 * @param src — 원문
 * @returns 정규화 문자열 + 글자별 원문 시작/끝 위치
 */
export function normalizeWithMap(src: string): NormalizedText {
  // 1) 공백으로 토큰을 나누고, 토큰마다 비교 글자만 남긴다(기호만 있는 토큰은 사라짐).
  type Token = { chars: string[]; starts: number[]; ends: number[] };
  const tokens: Token[] = [];
  let cur: Token | null = null;
  let i = 0;
  for (const ch of src) {
    if (/\s/.test(ch)) {
      cur = null;
    } else {
      const c = foldChar(ch);
      if (c) {
        if (!cur) {
          cur = { chars: [], starts: [], ends: [] };
          tokens.push(cur);
        }
        cur.chars.push(c);
        cur.starts.push(i);
        cur.ends.push(i + ch.length);
      }
    }
    i += ch.length;
  }

  // 2) 토큰을 잇는다. 양쪽 중 한쪽이라도 1글자 토큰이면 붙이고, 아니면 공백 하나로 경계를 남긴다.
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  tokens.forEach((t, k) => {
    const prev = k > 0 ? tokens[k - 1] : null;
    if (prev && prev.chars.length > 1 && t.chars.length > 1) {
      text += " ";
      starts.push(prev.ends[prev.ends.length - 1]);
      ends.push(t.starts[0]);
    }
    for (let j = 0; j < t.chars.length; j++) {
      text += t.chars[j];
      starts.push(t.starts[j]);
      ends.push(t.ends[j]);
    }
  });
  return { text, starts, ends };
}

/**
 * 금칙어 하나를 비교용 형태로 바꾼다(본문과 같은 규칙).
 * @param word — 금칙어 원문
 * @returns 정규화 형태(기호만 있는 단어면 빈 문자열)
 */
export function normalizeWord(word: string): string {
  return normalizeWithMap(word).text.trim();
}

/**
 * 여러 입력 필드에서 금칙어를 찾는다.
 * @param fields — 필드 키 → 원문 (비어 있으면 건너뜀)
 * @param words — 비교할 금칙어 목록(정규화 형태 포함)
 * @param limitPerField — 필드당 최대 검출 수(지나치게 긴 응답 방지). 기본 30
 * @returns 필드 순서 → 원문 위치 순으로 정렬된 검출 목록(없으면 빈 배열)
 */
export function findBannedMatches(
  fields: Record<string, string | null | undefined>,
  words: BannedWordEntry[],
  limitPerField = 30,
): BannedMatch[] {
  const out: BannedMatch[] = [];
  for (const [field, value] of Object.entries(fields)) {
    if (!value) continue;
    const n = normalizeWithMap(value);
    const found: BannedMatch[] = [];
    for (const w of words) {
      if (!w.norm) continue;
      let from = 0;
      while (found.length < limitPerField) {
        const at = n.text.indexOf(w.norm, from);
        if (at < 0) break;
        const start = n.starts[at];
        const end = n.ends[at + w.norm.length - 1];
        found.push({ field, word: w.word, start, end, text: value.slice(start, end) });
        from = at + w.norm.length;
      }
    }
    found.sort((a, b) => a.start - b.start || b.end - a.end);
    out.push(...found);
  }
  return out;
}

/**
 * 처음 만든 금칙어 표에 넣는 기본 목록이자, 관리자 화면 "기본 금칙어 추가" 버튼의 목록.
 * 일상어와 겹쳐 오탐이 잦은 단어(시발점·시바견·씹다·등신대 등)는 일부러 뺐다.
 */
export const DEFAULT_BANNED_WORDS: string[] = [
  "씨발",
  "씨팔",
  "씨빨",
  "ㅆㅂ",
  "ㅅㅂ",
  "병신",
  "븅신",
  "개새끼",
  "개새기",
  "개색기",
  "좆",
  "존나",
  "지랄",
  "미친놈",
  "미친년",
  "니애미",
  "느금마",
  "엠창",
  "썅",
  "fuck",
  "섹스",
  "야동",
];
