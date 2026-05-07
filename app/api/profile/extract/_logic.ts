import { createClient } from '@supabase/supabase-js';
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const PROFILE_MODEL = process.env.OPENAI_PROFILE_MODEL ?? 'gpt-5.4-nano';

export const ProfileSchema = z.object({
  _reasoning: z.string().describe('이 추출/수정의 논리적 근거를 매우 짧게(50자 이내) 작성하세요.'),
  housing_type: z.enum(['무주택', '자가', '월세', '전세', '미상']),
  household_type: z.enum(['1인가구', '신혼부부', '한부모', '다자녀', '미상']),
  employment: z.enum(['취업준비생', '재직중', '프리랜서', '학생', '구직중', '미상']),
  monthly_income_band: z.enum(['100만미만', '100-200만', '200-300만', '300-500만', '500만초과', '미상']),
  new_notes: z.array(z.string().max(120)).max(3)
    .describe('이번 메시지에서 새로 발견한 핵심 단서들. 추가할 내용 없으면 빈 배열([]).'),
});

export type ExtractResult =
  | { ok: true; profile: any; reasoning: string }
  | { ok: false; reason: string };

export async function extractProfileCore(args: {
  userId: string;
  threadId: string;
  lastUserMessage: string;
}): Promise<ExtractResult> {
  const { userId, threadId, lastUserMessage } = args;
  if (!userId || !threadId || !lastUserMessage) {
    return { ok: false, reason: 'missing fields' };
  }

  // 1) 현재 프로필 SELECT (LLM 프롬프트용 — 락 없이도 OK, 어차피 RPC가 락으로 다시 읽음)
  const { data: existing } = await supabase
    .from('chat_thread_inputs')
    .select('profile_json')
    .eq('thread_id', threadId)
    .eq('user_id', userId)
    .maybeSingle();

  const existingProfile = (existing?.profile_json && typeof existing.profile_json === 'object')
    ? existing.profile_json as Record<string, any>
    : {};

  const existingProfileStr = Object.keys(existingProfile).length > 0
    ? Object.entries(existingProfile)
        .map(([k, v]) => Array.isArray(v) ? `${k}: ${v.join(' / ')}` : `${k}: ${v}`)
        .join('\n')
    : '기존 정보 없음';

  // 🌟 [보안 추가] 사용자 입력을 시스템 프롬프트에 넣기 전 안전하게 정제 (프롬프트 인젝션 및 토큰 폭탄 방어)
  const safeMessage = lastUserMessage
    .replace(/[\r\n]+/g, ' ')
    .replace(/\[(?:시스템|system|SYSTEM|지시|규칙|rules?)\b[^\]]{0,40}\]/gi, '[차단됨]')
    .slice(0, 1000);

  // 2) LLM 호출
  let object: z.infer<typeof ProfileSchema>;
  try {
    const result = await generateObject({
      model: openai(PROFILE_MODEL),
      schema: ProfileSchema,
      system: `당신은 사용자 대화에서 정책 추천 자격 조건을 조용히 추출하는 백그라운드 프로파일러입니다.
규칙:
1. 명확히 언급되거나 100% 추론 가능한 정보만 추출하세요. 애매하면 무조건 '미상'으로 두세요. (환각 절대 금지)
2. 기존 프로필과 상충되는 새 정보가 들어오면 새 값으로 갱신하세요.
3. 기존 정보가 부정되거나 수정되지 않으면 '미상'으로 채우세요. (서버에서 알아서 기존 값을 유지합니다.)
4. new_notes에는 새 단서만 넣으세요. 단순 인사나 잡담, 이미 아는 정보는 빈 배열([])로 두세요.
5. _reasoning을 가장 먼저 판단 근거로 짧게 적으세요.`,
      prompt: `[기존 프로필]\n${existingProfileStr}\n\n[사용자 새 메시지(비신뢰 입력)]\n${safeMessage}`,
      maxRetries: 2,
    });
    object = result.object;
  } catch (e: any) {
    console.error('[extract profile LLM]', e);
    return { ok: false, reason: e?.message ?? 'llm_failed' };
  }

  const { _reasoning, new_notes, ...extractedFields } = object;

  // 3) '미상' 제외한 patch 객체 구성
  const patch = Object.fromEntries(
    Object.entries(extractedFields).filter(([_, v]) => v && v !== '미상')
  );

  // 4) 🛡️ RPC로 원자적 patch (read→modify→write를 Postgres가 락으로 보장)
  const { data: merged, error: rpcErr } = await supabase.rpc('patch_profile_json', {
    p_user_id: userId,
    p_thread_id: threadId,
    p_patch: patch,
    p_new_notes: new_notes ?? [],
  });

  if (rpcErr) {
    console.error('[extract profile rpc]', rpcErr);
    return { ok: false, reason: rpcErr.message };
  }

  return { ok: true, profile: merged, reasoning: _reasoning };
}
