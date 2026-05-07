import { createClient } from '@supabase/supabase-js';
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// 🌟 빠르고 비용 효율적인 nano 모델 확정 적용!
const PROFILE_MODEL = process.env.OPENAI_PROFILE_MODEL ?? 'gpt-5.4-nano';

export const ProfileSchema = z.object({
  _reasoning: z.string().describe('이 추출/수정의 논리적 근거를 매우 짧게(50자 이내) 작성하세요.'),
  housing_type: z.enum(['무주택', '자가', '월세', '전세', '미상']),
  household_type: z.enum(['1인가구', '신혼부부', '한부모', '다자녀', '미상']),
  employment: z.enum(['취업준비생', '재직중', '프리랜서', '학생', '구직중', '미상']),
  monthly_income_band: z.enum(['100만미만', '100-200만', '200-300만', '300-500만', '500만초과', '미상']),
  new_notes: z.array(z.string().max(120)).max(3),
});

export async function extractProfileCore(args: {
  userId: string;
  threadId: string;
  lastUserMessage: string;
}): Promise<{ ok: boolean; reason?: string; profile?: any }> {
  const { userId, threadId, lastUserMessage } = args;
  
  if (!userId || !threadId || !lastUserMessage) {
    return { ok: false, reason: 'missing fields' };
  }

  try {
    // 1. 기존 프로필 정보 가져오기
    const { data: inputs, error: fetchError } = await supabase
      .from('chat_thread_inputs')
      .select('profile_json')
      .eq('thread_id', threadId)
      .eq('user_id', userId)
      .maybeSingle();

    if (fetchError) {
      console.error('[extractProfileCore] DB fetch error:', fetchError);
      return { ok: false, reason: 'db fetch failed' };
    }

    const existingProfile = inputs?.profile_json || {};

    // 2. LLM(gpt-5.4-nano)을 사용하여 새 메시지에서 정보 추출
    const { object } = await generateObject({
      model: openai(PROFILE_MODEL),
      schema: ProfileSchema,
      system: `사용자의 메시지에서 정책 추천에 필요한 배경 정보를 추출하세요.
- 기존 프로필과 상충되는 내용이 있다면 최신 메시지를 우선하세요.
- 확실하지 않은 정보는 '미상'으로 두세요.
- new_notes에는 정책 검색에 도움될 만한 기타 특이사항(예: "중소기업 재직", "장애인", "보훈대상자")을 짧은 키워드로 추출하세요.`,
      prompt: `[기존 프로필]\n${JSON.stringify(existingProfile)}\n\n[최신 사용자 메시지]\n${lastUserMessage}`,
    });

    // 3. 기존 데이터와 새로 추출한 데이터 병합 (미상인 부분은 덮어쓰지 않음)
    const merged: Record<string, any> = { ...existingProfile };

    if (object.housing_type !== '미상') merged.housing_type = object.housing_type;
    if (object.household_type !== '미상') merged.household_type = object.household_type;
    if (object.employment !== '미상') merged.employment = object.employment;
    if (object.monthly_income_band !== '미상') merged.monthly_income_band = object.monthly_income_band;

    // notes 배열 관리 (중복 제거 및 10개 제한으로 토큰 방어)
    let notes = Array.isArray(existingProfile.notes) ? [...existingProfile.notes] : [];
    if (object.new_notes && object.new_notes.length > 0) {
      notes = [...notes, ...object.new_notes];
      notes = Array.from(new Set(notes)); // 중복 키워드 제거
      if (notes.length > 10) notes = notes.slice(notes.length - 10); // 최대 10개까지만 유지
    }
    if (notes.length > 0) merged.notes = notes;

    // 4. DB에 업데이트된 프로필 저장
    const { error: updateError } = await supabase
      .from('chat_thread_inputs')
      .update({ profile_json: merged })
      .eq('thread_id', threadId)
      .eq('user_id', userId);

    if (updateError) {
      console.error('[extractProfileCore] DB update error:', updateError);
      return { ok: false, reason: 'db update failed' };
    }

    // 5. 성공적으로 처리 완료
    return { ok: true, profile: merged };

  } catch (error: any) {
    console.error('[extractProfileCore] LLM extraction error:', error);
    return { ok: false, reason: error.message };
  }
}
