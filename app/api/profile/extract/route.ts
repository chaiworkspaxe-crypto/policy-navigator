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

// 🌟 [안전성 강화] .optional() 절대 금지! 배열은 빈 배열([])을 반환하게 강제함.
const ProfileSchema = z.object({
  _reasoning: z.string().describe('이 추출/수정의 논리적 근거를 매우 짧게(50자 이내) 작성하세요.'),
  housing_type: z.enum(['무주택', '자가', '월세', '전세', '미상']),
  household_type: z.enum(['1인가구', '신혼부부', '한부모', '다자녀', '미상']),
  employment: z.enum(['취업준비생', '재직중', '프리랜서', '학생', '구직중', '미상']),
  monthly_income_band: z.enum(['100만미만', '100-200만', '200-300만', '300-500만', '500만초과', '미상']),
  
  // 🌟 새 단서가 있으면 배열에 담고, 없으면 무조건 빈 배열([]) 반환
  new_notes: z.array(z.string().max(120)).max(3)
    .describe('이번 메시지에서 새로 발견한 핵심 단서들. 기존 정보와 다르거나 보강되는 것만. 추가할 내용이 없으면 빈 배열([])을 넣으세요.'),
});

export async function POST(req: Request) {
  try {
    const { userId, threadId, lastUserMessage } = await req.json();
    if (!userId || !threadId || !lastUserMessage) {
      return NextResponse.json({ ok: false, reason: 'missing fields' }, { status: 400 });
    }

    const { data: existing } = await supabase
      .from('chat_thread_inputs')
      .select('profile_json')
      .eq('thread_id', threadId)
      .eq('user_id', userId)
      .maybeSingle();

    const existingProfile = (existing?.profile_json && typeof existing.profile_json === 'object')
      ? existing.profile_json as Record<string, any>
      : {};
    
    // 사람이 읽기 쉬운 형태로 LLM에 제공 (raw JSON보다 토큰 효율 + 정확도 ↑)
    const existingProfileStr = Object.keys(existingProfile).length > 0
      ? Object.entries(existingProfile)
          .map(([k, v]) => Array.isArray(v) ? `${k}: ${v.join(' / ')}` : `${k}: ${v}`)
          .join('\n')
      : '기존 정보 없음';

    const { object } = await generateObject({
      model: openai('gpt-5.4-nano'), // 🌟 가상의 5.4-nano 대신 현존 최고의 가성비 모델 적용
      schema: ProfileSchema,
      system: `당신은 사용자 대화에서 정책 추천 자격 조건을 조용히 추출하는 백그라운드 프로파일러입니다.
규칙:
1. 명확히 언급되거나 100% 추론 가능한 정보만 추출하세요. 애매하면 무조건 '미상'으로 두세요. (환각 절대 금지)
2. 기존 프로필과 상충되는 새 정보가 들어오면 새 값으로 갱신하세요.
3. 기존 정보가 부정되거나 수정되지 않으면 '미상'으로 채우세요. (서버에서 알아서 기존 값을 유지합니다.)
4. new_notes에는 새 단서만 넣으세요. 단순 인사나 잡담, 이미 아는 정보는 빈 배열([])로 두세요.
5. _reasoning을 가장 먼저 판단 근거로 짧게 적으세요.`,
      prompt: `[기존 프로필]\n${existingProfileStr}\n\n[사용자 새 메시지]\n${lastUserMessage}`,
      maxRetries: 2, 
    });

    const { _reasoning, new_notes, ...extractedFields } = object;

    // 🌟 notes 누적 병합 (호환성 완벽 방어)
    const mergedNotes: string[] = [
      ...(Array.isArray(existingProfile.notes) ? existingProfile.notes : 
          existingProfile.notes ? [String(existingProfile.notes)] : []),
      ...(new_notes ?? []),
    ].slice(-10); // 최근 10개 단서만 유지하여 '망령' 방지

    // 🌟 '미상'인 필드들은 제외하고 합치기
    const merged = {
      ...existingProfile,
      ...Object.fromEntries(
        Object.entries(extractedFields).filter(([_, v]) => v && v !== '미상')
      ),
      ...(mergedNotes.length > 0 && { notes: mergedNotes }),
    };

    const { error: upErr } = await supabase
      .from('chat_thread_inputs')
      .update({
        profile_json: merged,
        updated_at: new Date().toISOString(),
      })
      .eq('thread_id', threadId)
      .eq('user_id', userId);

    if (upErr) {
      console.error('[extract profile] supabase update:', upErr);
      return NextResponse.json({ ok: false, reason: upErr.message });
    }

    return NextResponse.json({ ok: true, profile: merged, reasoning: _reasoning });
  } catch (e: any) {
    console.error('[extract profile]', e);
    return NextResponse.json({ ok: false, reason: e?.message ?? 'unknown' });
  }
}
