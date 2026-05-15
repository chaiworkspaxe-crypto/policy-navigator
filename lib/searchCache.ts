// lib/searchCache.ts
import { getSupabase } from '@/lib/supabase';

const supabase = getSupabase();

export type CacheableTool = 'naver' | 'tavily';
export type SearchMode = 'public' | 'private';

const STOPWORDS = new Set([
  '은', '는', '이', '가', '을', '를', '에', '의', '와', '과', '도', '로', '으로', '에서', '한테', '께',
  '관련', '대한', '대해', '관해', '말씀', '알려', '주세요', '주실래', '있나요', '있어요',
]);

function normalizeQuery(q: string): string {
  // 🌟 prefix 보호 로직 싹 날림! 오직 순수 검색어 자체만 정규화
  const siteMatches = Array.from(q.toLowerCase().matchAll(/site:[a-z0-9.-]+/g))
    .map(m => m[0]).sort();
  
  let s = q.toLowerCase()
    .replace(/site:[a-z0-9.-]+/g, ' ')
    .replace(/[?!,.~`'"()\[\]{}<>·•\-_]+/g, ' ')
    .trim();

  let tokens = s.split(/[\s\u00A0]+/).filter(Boolean);
  tokens = tokens.map(t => {
    for (const sw of STOPWORDS) {
      if (t.endsWith(sw) && t.length > sw.length + 1) {
        t = t.slice(0, -sw.length);
      }
    }
    return t;
  }).filter(t => t.length > 0);

  tokens.sort();
  
  let normalized = tokens.join('');
  if (siteMatches.length > 0) {
    normalized = normalized + '|' + siteMatches.join(',');
  }

  return normalized.slice(0, 200); 
}

async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// 🛡️ [핵심 변경] 격벽 다중화 — mode를 해시 입력에 명시적으로 포함
async function makeCacheKey(tool: CacheableTool, mode: SearchMode, query: string): Promise<string> {
  return sha256Hex(`${mode}::${tool}::${normalizeQuery(query)}`);
}

export async function getCachedSearch(
  tool: CacheableTool,
  mode: SearchMode, // 🌟 명시적 인자
  query: string,
): Promise<string | null> {
  try {
    // 🌟 [핵심 변경] 해시 생성 시 mode 전달
    const queryHash = await makeCacheKey(tool, mode, query);

    const { data, error } = await supabase
      .from('search_cache')
      .select('result')
      .eq('search_mode', mode) // 🛡️ DB 레벨 2차 격벽
      .eq('query_hash', queryHash)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (error) {
      console.warn('[searchCache.get]', error.message);
      return null;
    }
    if (!data?.result) return null;

    // 🌟 RPC 파라미터 2개 전달
    void supabase
      .rpc('inc_search_cache_hit', { p_search_mode: mode, p_query_hash: queryHash })
      .then(({ error: rpcErr }) => {
        if (rpcErr) console.warn('[inc_search_cache_hit]', rpcErr.message);
      });

    return data.result;
  } catch (e: any) {
    console.warn('[searchCache.get exception]', e?.message);
    return null;
  }
}

const SHOULD_NOT_CACHE_PATTERNS = [
  /일시 (장애|실패)/, /미설정/, /타임아웃/, /결과 없음/, /API 키/,
  /\b\d{3}\b.{0,10}에러/, /rate.?limit/i, /quota/i, /unauthor/i,
  /forbidden/i, /\berror\b/i, /\bfail/i, /\[중복 호출 차단\]/, /\[도구 예외\]/,
];

export async function setCachedSearch(
  tool: CacheableTool,
  mode: SearchMode, // 🌟 명시적 인자
  query: string,
  result: string,
  ttlHours: number,
): Promise<void> {
  try {
    if (!result || result.length < 30) return;
    if (SHOULD_NOT_CACHE_PATTERNS.some((re) => re.test(result))) return;

    // 🌟 [핵심 변경] 해시 생성 시 mode 전달
    const queryHash = await makeCacheKey(tool, mode, query);
    const expiresAt = new Date(Date.now() + ttlHours * 3600_000).toISOString();
    const normalized = normalizeQuery(query);

    const { error } = await supabase.from('search_cache').upsert(
      {
        search_mode: mode, // 🌟 DB 컬럼으로 저장
        query_hash: queryHash,
        tool_name: tool,
        query: normalized,
        result,
        expires_at: expiresAt,
      },
      { onConflict: 'search_mode,query_hash' } // 🌟 복합 키 기준 Upsert
    );

    if (error) console.warn('[searchCache.set]', error.message);
  } catch (e: any) {
    console.warn('[searchCache.set exception]', e?.message);
  }
}
