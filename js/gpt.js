import { precheckSkip, emptyAnalyze } from "./rules.js";

const SYSTEM = `당신은 이커머스 검색 엔진의 '검색 실패어' 분석가입니다. 입력된 검색어 하나에 대해 아래 우선순위를 **반드시** 따르세요.

## 1) SKIP (최우선)
다음에 해당하면 suggested는 빈 문자열 "", reason에 구체적 사유:
- 이벤트/행사/프로모션/CS·상담·환불·교환·배송조회 등 운영/고객응대 성격
- 상품이 아닌 **모델명** 추정: 영문과 숫자가 섞인 코드형(예: XR-200, ABC123)
- **20자 이상** (공백 포함 길이)
- **홈쇼핑/방송사 쇼핑** 등 플랫폼·회사명 중심 키워드

(참고: 클라이언트에서 일부 SKIP은 이미 걸러질 수 있음. 그래도 해당이면 SKIP 유지)

## 2~3) 을 수행하기 전 검색어에 포함된 [브랜드/카테고리/가격/특징] 을 분리한 후 분석할 것.

## 2) 오타 교정 (Critical) — SKIP이 아닐 때만
**오타가 확실한 경우에만** 교정. 키보드 인접 오타, 음절 치환 등 합리적 근거가 있을 때만.
- 브랜드: 국내 이커머스에서 흔한 브랜드의 오타·약어 → 정식 표기 (확실할 때만)
- 일반명사: 표준어에 가까운 명사 오타 (확실할 때만)
- 애매하면 교정하지 말고 3)으로 넘기거나 reason에 "교정 없음(불확실)".

## 3) 유의어 제안
교정이 필요 없는 정상 키워드인데 검색 확장이 필요하면 **대표 키워드**로 통합 제안 (예: "반팔 티셔츠" → "반팔티").
이미 검색어가 대표형이면 suggested에 동일어를 두고 reason "유의어 제안(이미 대표형)" 또는 교정 없음 처리.

## 출력 JSON만 (코드펜스 없이):
{"suggested":"","reason":""}
- suggested: 제안 검색어 (SKIP이면 "")
- reason: 한 줄, 예: "SKIP(20자 이상 장문 검색어)", "오타 교정(브랜드)", "오타 교정(일반명사)", "유의어 제안", "교정 없음(정상)"

반드시 유효한 JSON 한 객체만 출력하세요.`;

function safeJsonParse(s) {
  const t = s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* empty */
      }
    }
  }
  return {};
}

function normalizeBaseUrl(base) {
  const b = (base || "").trim() || "https://api.openai.com/v1";
  return b.replace(/\/$/, "");
}

/**
 * @param {string} keyword
 * @param {{ apiKey: string; baseUrl?: string; model?: string }} opts
 */
export async function analyzeKeyword(keyword, opts) {
  const skip = precheckSkip(keyword);
  if (skip.skip) return emptyAnalyze(keyword, skip.reason);

  const apiKey = (opts.apiKey || "").trim();
  if (!apiKey) {
    return { original: keyword, suggested: "", reason: "오류: API 키를 입력하세요." };
  }

  const base = normalizeBaseUrl(opts.baseUrl);
  const model = (opts.model || "gpt-4o-mini").trim();
  const url = `${base}/chat/completions`;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `검색어: ${keyword}` },
        ],
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      original: keyword,
      suggested: "",
      reason: `요청 실패(네트워크/CORS 가능): ${msg}`,
    };
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = data.error?.message || data.message || res.statusText;
    return {
      original: keyword,
      suggested: "",
      reason: `API 오류 ${res.status}: ${errMsg}`,
    };
  }

  const raw = data.choices?.[0]?.message?.content ?? "";
  const j = safeJsonParse(raw);
  const suggested = typeof j.suggested === "string" ? j.suggested.trim() : "";
  const reason = typeof j.reason === "string" ? j.reason.trim() : "분석 실패(JSON 파싱)";

  return {
    original: keyword,
    suggested,
    reason: reason || "분석 완료",
  };
}
