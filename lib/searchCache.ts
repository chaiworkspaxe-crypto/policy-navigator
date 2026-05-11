// lib/searchCache.ts
// 🌟 도구(naver, tavily) 호출 결과를 DB에 캐싱한다.
// - 동일/유사 쿼리에 즉시 재사용 → API 비용 절감 + 응답 latency 단축
// - 에러/빈 결과는 캐싱하지 않음 (다음 호출에 재시도되도록)
// - 캐시 저장은 fire-and-forget (사용자 응답 지연 0)

import { createClient } from '@supabase/supabase-js';

// 🌟 chat/route.ts 와 동일 패턴으로 모듈 스코프 1개 인스턴스
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export type CacheableTool = 'naver' | 'tavily';

// 🌟 한국어 검색 정규화 강화: 띄어쓰기/조사/특수문자 차이 무시
const STOPWORDS = new Set([
  // 조사
  '은', '는', '이', '가', '을', '를', '에', '의', '와', '과', '도', '로', '으로', '에서', '한테', '께',
  // 흔한 접미어
  '관련', '대한', '대해', '관해', '말씀', '알려', '주세요', '주실래', '있나요', '있어요',
]);

// ────────────────────────────────────────────────────────────
// 1) 쿼리 정규화 — 작은 표기 차이를 같은 캐시 키로 모음
// ────────────────────────────────────────────────────────────
function normalizeQuery(q: string): string {
  // 1) 기본 정규화: 소문자화 + 모든 공백 제거 + 흔한 구두점 제거
  let s = q.trim().toLowerCase()
    .replace(/[\s\u00A0]+/g, '')           // "청년 월세" === "청년월세"
    .replace(/[?!,.~`'"()\[\]{}<>·•\-_]+/g, ''); // 기호 날리기

  // 2) 조사/불용어 제거 (간이 morphology)
  for (const sw of STOPWORDS) {
    s = s.split(sw).join('');
  }

  // 3) site: 같은 검색 연산자는 순서가 달라도 같게 취급되도록 일관된 위치로 정렬
  const siteMatches = Array.from(s.matchAll(/site:[a-z0-9.-]+/g)).map(m => m[0]).sort();
  if (siteMatches.length > 0) {
    s = s.replace(/site:[a-z0-9.-]+/g, '') + '|' + siteMatches.join(',');
  }

  return s.slice(0, 200); // 안전 상한 (해시 생성 전 너무 긴 쿼리 방지)
}

// ────────────────────────────────────────────────────────────
// 2) SHA-256 해시 (Edge Runtime 호환 — crypto.subtle 사용)
// ────────────────────────────────────────────────────────────
async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function makeCacheKey(tool: CacheableTool, query: string): Promise<string> {
  return sha256Hex(`${tool}::${normalizeQuery(query)}`);
}

// ────────────────────────────────────────────────────────────
// 3) 캐시 조회 (hit이면 결과 반환 + hit_count 비동기 증가)
// ────────────────────────────────────────────────────────────
export async function getCachedSearch(
  tool: CacheableTool,
  query: string,
): Promise<string | null> {
  try {
    const queryHash = await makeCacheKey(tool, query);

    const { data, error } = await supabase
      .from('search_cache')
      .select('result')
      .eq('query_hash', queryHash)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (error) {
      // 캐시 장애는 정상 흐름에 영향 주지 않음 — null 반환해서 fresh fetch로 유도
      console.warn('[searchCache.get]', error.message);
      return null;
    }
    if (!data?.result) return null;

    // 🌟 hit_count 증가는 fire-and-forget (사용자 응답 지연 없음)
    void supabase
      .rpc('inc_search_cache_hit', { p_query_hash: queryHash })
      .then(({ error: rpcErr }) => {
        if (rpcErr) console.warn('[inc_search_cache_hit]', rpcErr.message);
      });

    return data.result;
  } catch (e: any) {
    console.warn('[searchCache.get exception]', e?.message);
    return null;
  }
}

// ────────────────────────────────────────────────────────────
// 4) 캐시 저장 (fire-and-forget — await 안 해도 됨)
//    아래 조건이면 저장 안 함:
//    - 결과가 30자 미만 (빈 결과/짧은 에러)
//    - 결과에 시스템 장애 키워드 포함 (도구가 우회 안내 메시지 반환한 경우)
// ────────────────────────────────────────────────────────────
const SHOULD_NOT_CACHE_PATTERNS = [
  /일시 (장애|실패)/,
  /미설정/,
  /타임아웃/,
  /결과 없음/,
  /API 키/,
  /\b\d{3}\b.{0,10}에러/,                    // "400 에러", "500 에러" 등
];

export async function setCachedSearch(
  tool: CacheableTool,
  query: string,
  result: string,
  ttlHours: number,
): Promise<void> {
  try {
    // 🛡️ 캐싱 부적합 결과 필터링
    if (!result || result.length < 30) return;
    if (SHOULD_NOT_CACHE_PATTERNS.some((re) => re.test(result))) return;

    const queryHash = await makeCacheKey(tool, query);
    const expiresAt = new Date(Date.now() + ttlHours * 3600_000).toISOString();
    const normalized = normalizeQuery(query);

    const { error } = await supabase.from('search_cache').upsert(
      {
        query_hash: queryHash,
        tool_name: tool,
        query: normalized, // 정규화된 형태를 저장해서 DB에서 확인하기 용이하게 함
        result,
        expires_at: expiresAt,
        // hit_count는 upsert 시 기본값 1로 들어가지만, 
        // 같은 키 재저장 시 기존 hit_count 리셋 방지를 원한다면 향후 RPC 도입 고려
      },
      { onConflict: 'query_hash' },
    );

    if (error) console.warn('[searchCache.set]', error.message);
  } catch (e: any) {
    console.warn('[searchCache.set exception]', e?.message);
  }
}
