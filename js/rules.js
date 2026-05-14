/** 4번째 행(1-based) = 인덱스 3 */
export const HEADER_ROW_INDEX = 3;

const EVENT_CS_KEYWORDS = [
  "이벤트",
  "행사",
  "세일",
  "할인",
  "쿠폰",
  "프로모션",
  "출석체크",
  "경품",
  "사은품",
  "CS",
  "고객센터",
  "상담",
  "문의",
  "불만",
  "환불",
  "교환",
  "반품",
  "배송조회",
  "택배",
  "A/S",
  "AS접수",
  "클레임",
];

const COMPANY_KEYWORDS = [
  "현대홈쇼핑",
  "현대H몰",
  "H몰",
  "GS홈쇼핑",
  "GS샵",
  "CJ온스타일",
  "롯데홈쇼핑",
  "롯데ON",
  "SK스토아",
  "NS홈쇼핑",
  "공영홈쇼핑",
  "쇼핑엔티",
  "홈앤쇼핑",
  "KT알파쇼핑",
];

const MODEL_LIKE = /[A-Za-z].*\d|\d.*[A-Za-z]/;

function containsKeyword(text, keywords) {
  const t = text.toLowerCase();
  for (const k of keywords) {
    if (k.length <= 2 && /^(cs|as)$/i.test(k)) {
      if (new RegExp(`\\b${k}\\b`, "i").test(text)) return true;
      continue;
    }
    if (text.includes(k) || t.includes(k.toLowerCase())) return true;
  }
  return false;
}

export function precheckSkip(keyword) {
  const raw = keyword.trim();
  if (!raw) return { skip: true, reason: "SKIP(빈 검색어)" };

  if (raw.length >= 20) {
    return { skip: true, reason: "SKIP(20자 이상 장문 검색어)" };
  }

  if (containsKeyword(raw, EVENT_CS_KEYWORDS)) {
    return { skip: true, reason: "SKIP(이벤트/행사/CS 관련 키워드)" };
  }

  if (containsKeyword(raw, COMPANY_KEYWORDS)) {
    return { skip: true, reason: "SKIP(회사명/홈쇼핑 키워드)" };
  }

  const noSpace = raw.replace(/\s+/g, "");
  if (MODEL_LIKE.test(noSpace) && /[A-Za-z]/.test(noSpace) && /\d/.test(noSpace)) {
    return { skip: true, reason: "SKIP(모델명: 영문+숫자 혼합 추정)" };
  }

  return { skip: false };
}

export function emptyAnalyze(keyword, reason) {
  return { original: keyword, suggested: "", reason };
}
