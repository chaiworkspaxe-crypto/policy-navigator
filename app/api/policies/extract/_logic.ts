// 📁 app/api/policies/extract/_logic.ts (신규 생성)
import { openai } from '@ai-sdk/openai';
import { generateObject, embed } from 'ai';
// ... 기존에 route.ts에 있던 import들 ...

export async function extractPoliciesCore(args: { text: string }) {
  const { text } = args;
  if (!text || text.length < 100) return { ok: false, reason: 'too_short' };

  try {
    // 여기에 기존 route.ts에 있던 LLM 추출 및 DB Upsert 로직을 그대로 넣습니다!
    // ...
    return { ok: true, count: 1 /* 삽입된 개수 */ };
  } catch (error) {
    console.error('[extractPoliciesCore Error]', error);
    throw error;
  }
}
