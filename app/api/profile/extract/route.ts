// app/api/profile/extract/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

export const runtime = 'edge';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// 🌟 [고급화 1] AI의 판단력을 극대화하는 Zod 스키마 설계
const ProfileSchema = z.object({
  // AI가 결론을 내리기 전, 논리적 근거를 먼저 적게 하여 정확도 200% 상승 (Chain of Thought)
  _reasoning: z.string().describe('사용자 메시지에서 이 정보들을 추출하거나 기존 정보를 수정한 논리적 근거를 짧게 작성하세요.'),
  
  housing_type: z.enum(['무주택', '자가', '월세', '전세', '미상']).optional(),
  household_type: z.enum(['1인가구', '신혼부부', '한부모', '다자녀', '미상']).optional(),
  employment: z.enum(['취업준비생', '재직중', '프리랜서', '학생', '구직중', '미상']).optional(),
  monthly_income_band: z.enum(['100만미만', '100-200만', '200-300만', '300-500만', '500만초과', '미상']).optional(),
  
  // 자유 메모 강화
  notes: z.string().max(200).describe('위 카테고리에 속하지 않는 중요한 단서 (예: "오늘 자취 시작함", "관심사: 창업" 등)').optional(),
});

export async function POST(req: Request) {
  try {
    const { userId, threadId, lastUserMessage } = await req.json();
    if (!userId || !threadId || !lastUserMessage) {
      return NextResponse.json({ ok: false, reason: 'missing fields' });
    }

    // 1. 기존 프로필 로드
    const { data: existing } = await supabase
      .from('chat_thread_inputs')
      .select('extra_info, profile_json')
      .eq('thread_id', threadId)
      .eq('user_id', userId)
      .maybeSingle();

    // 🌟 [고급화 2] [object Object] 버그 해결 (정확한 JSON 문자열로 변환)
    const existingProfileStr = existing?.profile_json && Object.keys(existing.profile_json).length > 0
      ? JSON.stringify(existing.profile_json)
      : '기존 정보 없음';

    // 2. 미니 모델로 구조화 추출
    const { object } = await generateObject({
      model: openai('gpt-5.4-mini'),
      schema: ProfileSchema,
      // 🌟 [고급화 3] 프롬프트 엔지니어링 강화 (단순 추출을 넘어 '업데이트' 기능 명시)
      system: `당신은 사용자의 대화에서 정책 추천에 필요한 자격 조건을 조용히 추출하는 최고 수준의 백그라운드 프로파일러입니다.
1. 명확히 언급되거나 100% 추론 가능한 정보만 추출하세요. 조금이라도 애매하면 '미상'으로 두세요. (절대 환각 금지)
2. 기존 프로필과 상충되는 새로운 정보가 들어오면(예: "나 방금 퇴사했어" -> 기존 '재직중'을 '구직중'으로) 덮어쓰세요.
3. 기존 정보가 새 메시지에서 부정되지 않았다면 그대로 유지하세요.
4. 반드시 '_reasoning' 필드에 당신의 논리적 판단 과정을 먼저 짧게 적은 후 나머지 값을 채우세요.`,
      prompt: `[기존 프로필]\n${existingProfileStr}\n\n[사용자 새 메시지]\n${lastUserMessage}`,
      maxRetries: 1,
    });

    // 3. 비어있지 않은 필드만 머지 (_reasoning 필드는 DB에 굳이 저장할 필요 없으니 분리)
    const { _reasoning, ...extractedData } = object;

    const merged = {
      ...(existing?.profile_json || {}),
      ...Object.fromEntries(
        Object.entries(extractedData).filter(([_, v]) => v && v !== '미상')
      ),
    };

    // 4. 저장 (chat_thread_inputs에 profile_json JSONB 컬럼 필수)
    await supabase
      .from('chat_thread_inputs')
      .update({
        profile_json: merged,
        updated_at: new Date().toISOString(),
      })
      .eq('thread_id', threadId)
      .eq('user_id', userId);

    return NextResponse.json({ ok: true, profile: merged });
  } catch (e: any) {
    console.error('[extract profile]', e);
    return NextResponse.json({ ok: false, reason: e?.message }, { status: 200 });
    // 실패해도 메인 채팅 서비스는 정상 작동하도록 200 반환
  }
}
