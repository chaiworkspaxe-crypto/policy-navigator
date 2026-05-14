// lib/embeddingCache.ts
import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';

// 🌟 Edge 워커가 살아있는 동안 유지되는 인메모리 LRU (최대 256개 기억)
const MAX_CACHE = 256;
const cache = new Map<string, number[]>();

function setLRU(key: string, value: number[]) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > MAX_CACHE) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
}

function normalize(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, '');
}

export async function getEmbedding(
  query: string,
  signal?: AbortSignal,
): Promise<number[]> {
  const key = normalize(query);
  const hit = cache.get(key);
  
  // 캐시 적중 시
  if (hit) {
    cache.delete(key); 
    cache.set(key, hit); // 최근 사용된 녀석으로 순서 갱신(Touch)
    return hit;
  }

  // 캐시 미스 시 실제 API 호출
  const { embedding } = await embed({
    model: openai.embedding('text-embedding-3-small'),
    value: query,
    abortSignal: signal,
  });

  if (Array.isArray(embedding) && embedding.length > 0) {
    setLRU(key, embedding);
  }
  
  return embedding;
}
