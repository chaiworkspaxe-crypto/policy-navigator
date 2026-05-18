// lib/embeddingCache.ts
import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';

// 🌟 Edge 워커가 살아있는 동안 유지되는 인메모리 LRU (최대 256개 기억)
const MAX_CACHE = 256;
const cache = new Map<string, number[]>();

// 🛡️ [핵심 변경] 임베딩 무결성 검증을 위한 상수 정의
const EXPECTED_DIM = 1536; // text-embedding-3-small 모델의 고정 차원 수
const MIN_KEY_LEN = 2;
const MAX_KEY_LEN = 400;
const EMBEDDING_TIMEOUT_MS = 4_000; // 🌟 [신규] 임베딩 전용 짧은 timeout

function setLRU(key: string, value: number[]) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > MAX_CACHE) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
}

function normalize(q: string): string {
  // 🛡️ [핵심 변경] 비정상적으로 긴 텍스트가 메모리 키로 들어가는 것 방지
  return q.trim().toLowerCase().replace(/\s+/g, '').slice(0, MAX_KEY_LEN);
}

export async function getEmbedding(
  query: string,
  signal?: AbortSignal,
): Promise<number[]> {
  const key = normalize(query);

  // 🛡️ [핵심 변경] 가드: 비정상 입력은 캐시 안 거치고 즉시 빈 배열 반환
  if (key.length < MIN_KEY_LEN) {
    console.warn('[embeddingCache] invalid key length:', key.length);
    return [];
  }

  const hit = cache.get(key);
  
  // 🛡️ [핵심 변경] 캐시 적중 시 차원 수까지 완벽히 일치하는지 검증
  if (hit && hit.length === EXPECTED_DIM) {
    cache.delete(key); 
    cache.set(key, hit); // Touch (LRU 순서 갱신)
    return hit;
  }
  
  // 만약 과거에 잘못된 차원의 캐시가 남아있다면 오염으로 간주하고 삭제
  if (hit && hit.length !== EXPECTED_DIM) {
    console.warn(`[embeddingCache] Removing corrupted cache for key: ${key}`);
    cache.delete(key);
  }

  // 🌟 [핵심 변경] 외부 signal과 자체 4초 timeout을 결합
  const ctrl = new AbortController();
  const onParentAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', onParentAbort, { once: true });
  }
  const timeoutId = setTimeout(() => ctrl.abort(new Error('embedding-timeout')), EMBEDDING_TIMEOUT_MS);

  try {
    // 캐시 미스 시 실제 API 호출
    const { embedding } = await embed({
      model: openai.embedding('text-embedding-3-small'),
      value: query,
      abortSignal: ctrl.signal,
    });

    // 🛡️ [핵심 변경] 결과 배열 길이 검증 — 비정상 응답은 캐시 오염 방지
    if (Array.isArray(embedding) && embedding.length === EXPECTED_DIM) {
      setLRU(key, embedding);
    } else {
      console.warn('[embeddingCache] unexpected embedding length:', embedding?.length);
    }
    
    return embedding;
  } catch (e: any) {
    console.warn('[embeddingCache] embed failed:', e?.message);
    return [];   // 🛡️ 빈 배열 반환 — chat/route.ts의 "임베딩 일시 실패 → 웹 검색으로 우회" 분기와 호환
  } finally {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onParentAbort);
  }
}
