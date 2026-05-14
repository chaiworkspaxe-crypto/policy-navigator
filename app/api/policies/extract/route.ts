// app/api/policies/extract/route.ts
import { openai } from '@ai-sdk/openai';
import { generateObject, embed } from 'ai';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export const runtime = 'edge';

// 🌟 [핵심] LLM에게 뽑아낼 데이터의 엄격한 JSON 규격(Schema)을 강제
const ExtractedPoliciesSchema = z.object({
  policies: z.array(
    z.object({
      title: z.string().describe('정책 또는 부트캠프/지원금의 이름'),
      provider: z.string().describe('주관하는 기업명 또는 재단명'),
      summary: z.string().describe('지원 대상, 혜택, 자격 조건 등을 100자 이내로 요약'),
      url: z.string().url().describe('반드시 http/https로 시작하는 공식 링크'),
      deadline: z.string().nullable().describe('마감일이 있다면 YYYY-MM-DDTHH:mm:ssZ (ISO 8601) 형식. 상시모집이거나 알 수 없으면 null'),
    })
  ).describe('추출된 정책 리스트. URL이 없는 항목은 제외하세요.'),
});

export async function POST(req: Request) {
  try {
    // 내부 API 호출인지 검증 (보안)
    const internalSecret = req.headers.get('x-internal-secret');
    if (internalSecret !== process.env.INTERNAL_API_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }

    const { text } = await req.json();
    if (!text || text.length < 50) return new Response('Too short', { status: 200 });

    // 1. 저렴하고 빠른 nano 모델로 JSON 데이터 추출
    const { object } = await generateObject({
      model: openai('gpt-5.4-nano'),
      schema: ExtractedPoliciesSchema,
      system: `당신은 AI가 작성한 정책 안내 텍스트에서 데이터베이스 삽입용 JSON을 추출하는 데이터 엔지니어입니다.
규칙:
1. URL이 없거나 '...' 등으로 잘려있는 불확실한 정책은 무조건 버리세요.
2. deadline(마감일)은 정확한 날짜가 명시된 경우만 ISO 포맷으로 변환하고, 애매하면 null을 넣으세요.`,
      prompt: `아래 텍스트에서 민간/기업 혜택 정보를 추출하세요:\n\n${text}`,
    });

    const policies = object.policies;
    if (!policies || policies.length === 0) {
      return new Response('No valid policies found', { status: 200 });
    }

    // 2. 추출된 데이터에 임베딩 벡터 생성 및 DB 삽입 준비
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
            source_type: 'private', // 민간 데이터 태그 쾅!
          }, {
            onConflict: 'url', // URL이 같으면 기존 데이터를 업데이트(덮어쓰기)
            ignoreDuplicates: false,
          });

        if (error) console.error(`[DB Upsert Error] ${policy.title}:`, error.message);
        
      } catch (embErr) {
        console.error(`[Embedding Error] ${policy.title}:`, embErr);
      }
    }

    return new Response(JSON.stringify({ success: true, count: policies.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Policy Extract Worker Error]', error);
    Sentry.captureException(error);
    return new Response('Internal Error', { status: 500 });
  }
}
