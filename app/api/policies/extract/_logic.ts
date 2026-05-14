// app/api/policies/extract/_logic.ts
import { openai } from '@ai-sdk/openai';
import { generateObject, embed } from 'ai';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const EXTRACT_MODEL = process.env.OPENAI_EXTRACT_MODEL ?? 'gpt-5.4-nano';

// 🌟 [핵심] LLM에게 뽑아낼 데이터의 엄격한 JSON 규격(Schema) 강제
export const ExtractedPoliciesSchema = z.object({
  policies: z.array(
    z.object({
      title: z.string().describe('정책 또는 부트캠프/지원금의 이름'),
      provider: z.string().describe('주관하는 기업명 또는 재단명'),
      summary: z.string().describe('지원 대상, 혜택, 자격 조건 등을 100자 이내로 요약'),
      url: z.string().url().describe('반드시 http/https로 시작하는 공식 링크'),
      deadline: z.string().nullable().describe('마감일이 있다면 YYYY-MM-DDTHH:mm:ssZ (ISO 8601) 형식. 상시모집이거나 알 수 없으면 null'),
    })
  ).describe('추출된 정책 리스트. URL이 없거나 "..."으로 잘린 불확실한 항목은 절대 포함하지 마세요.'),
});

export type PolicyExtractResult = 
  | { ok: true; count: number }
  | { ok: false; reason: string };

export async function extractPoliciesCore(args: { text: string }): Promise<PolicyExtractResult> {
  const { text } = args;
  if (!text || text.length < 100) return { ok: false, reason: 'too_short' };

  let object: z.infer<typeof ExtractedPoliciesSchema>;

  try {
    // 1. 저렴하고 빠른 nano 모델로 JSON 데이터 추출
    const result = await generateObject({
      model: openai(EXTRACT_MODEL),
      schema: ExtractedPoliciesSchema,
      system: `당신은 AI가 작성한 정책 안내 텍스트에서 데이터베이스 삽입용 JSON을 추출하는 데이터 엔지니어입니다.
규칙:
1. URL이 없거나 '...' 등으로 잘려있는 불확실한 혜택은 무조건 버리세요.
2. deadline(마감일)은 정확한 날짜가 명시된 경우만 ISO 포맷으로 변환하고, 애매하면 null을 넣으세요.`,
      prompt: `아래 텍스트에서 민간/기업 혜택 정보를 추출하세요:\n\n${text}`,
      maxRetries: 1, // 백그라운드 작업이므로 실패 시 너무 오래 재시도하지 않음
    });
    object = result.object;
  } catch (e: any) {
    console.error('[extract policies LLM Error]', e);
    return { ok: false, reason: e?.message ?? 'llm_failed' };
  }

  const policies = object.policies;
  if (!policies || policies.length === 0) {
    return { ok: false, reason: 'no_valid_policies' };
  }

  let insertedCount = 0;

  // 2. 추출된 데이터에 임베딩 벡터 생성 및 DB 삽입
  for (const policy of policies) {
    try {
      // 검색에 잘 걸리도록 제목과 요약을 합쳐서 임베딩
      const embedText = `[${policy.provider}] ${policy.title} - ${policy.summary}`;
      const { embedding } = await embed({
        model: openai.embedding('text-embedding-3-small'),
        value: embedText,
      });

      // 3. 🌟 Supabase에 Upsert (중복 URL 방어)
      const { error } = await supabase
        .from('policies')
        .upsert({
          title: policy.title,
          provider: policy.provider,
          summary: policy.summary,
          url: policy.url,
          deadline: policy.deadline,
          embedding: embedding,
          source_type: 'private', // 🌟 민간 데이터 태그 쾅!
        }, {
          onConflict: 'url', // URL이 같으면 기존 데이터를 덮어쓰기
        });

      if (error) {
        console.error(`[DB Upsert Error] ${policy.title}:`, error.message);
      } else {
        insertedCount++;
      }
      
    } catch (embErr) {
      console.error(`[Embedding Error] ${policy.title}:`, embErr);
    }
  }

  return { ok: true, count: insertedCount };
}
