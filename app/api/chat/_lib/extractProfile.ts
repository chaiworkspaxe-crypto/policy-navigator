import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PROFILE_KEYWORDS = [
  '무주택', '전세', '월세', '자가', '집', '주거',
  '결혼', '신혼', '미혼', '한부모', '아이', '자녀', '출산', '임신',
  '직장', '취업', '구직', '백수', '창업', '학생', '재직', '회사',
  '연봉', '소득', '수입', '월급',
  '장애', '보훈', '다문화', '차상위', '기초생활',
];

const PROFILE_EXTRACTION_PROMPT = `사용자 메시지에서 정책 자격 관련 정보를 추출하세요.

사용자 메시지: "{message}"

다음 JSON 형식만 응답:
{
  "household_type": "1인가구" | "신혼" | "한부모" | "다자녀" | "일반" | null,
  "housing_status": "무주택" | "전세" | "월세" | "자가" | null,
  "employment_status": "재직" | "구직" | "창업" | "학생" | null,
  "special_status": ["한부모", "장애", "보훈", "다문화", "차상위"] | []
}

규칙: 메시지에 명시적이거나 강하게 암시된 것만 추출. 추측 금지. 확신 없으면 null.`;


export function needsProfileExtraction(message: string): boolean {
  return PROFILE_KEYWORDS.some(kw => message.includes(kw));
}

export async function extractAndSaveProfile(userId: string, userMessage: string) {
  if (!needsProfileExtraction(userMessage)) return;
  
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.4", // 💡 꿀팁: 백그라운드 작업은 "gpt-4o-mini" 같은 저렴한 모델을 쓰면 돈을 엄청 아낄 수 있어!
      messages: [{
        role: "user",
        content: PROFILE_EXTRACTION_PROMPT.replace("{message}", userMessage.slice(0, 500))
      }],
      response_format: { type: "json_object" },
    });
    
    // 🌟 [수리 2] AI가 마크다운(```json)을 붙여서 줘도 깔끔하게 벗겨내는 방어막
    let rawContent = response.choices[0].message.content || '{}';
    rawContent = rawContent.replace(/```json\n?|```/g, '').trim();
    const extracted = JSON.parse(rawContent);
    
    if (!extracted) return;

    // 🌟 [수리 1] 빈 배열([])이나 null만 있는 쓰레기 데이터는 DB에 안 넣게 확실히 걸러냄!
    const hasValidData = Object.entries(extracted).some(([key, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== null && value !== undefined && value !== "";
    });
    
    if (!hasValidData) return;
    
    // UPSERT (단순 필드)
    const updateData: any = { user_id: userId, updated_at: new Date().toISOString() };
    if (extracted.household_type) updateData.household_type = extracted.household_type;
    if (extracted.housing_status) updateData.housing_status = extracted.housing_status;
    if (extracted.employment_status) updateData.employment_status = extracted.employment_status;
    
    if (Object.keys(updateData).length > 2) { 
      await supabase
        .from('user_profiles')
        .upsert(updateData, { onConflict: 'user_id' });
    }
    
    // special_status는 배열 합집합
    if (extracted.special_status && Array.isArray(extracted.special_status) && extracted.special_status.length > 0) {
      await supabase.rpc('merge_user_special_status', {
        p_user_id: userId,
        p_new_status: extracted.special_status,
      });
    }
  } catch (e) {
    console.error('profile extraction failed:', e);
  }
}

export async function loadUserProfile(userId: string) {
  if (!userId) return null;
  
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .single();
    
  if (error || !data) return null;
  return data;
}

export function formatProfileForLLM(profile: any): string {
  if (!profile) return "";
  
  const items: string[] = [];
  if (profile.household_type) items.push(`가구 형태: ${profile.household_type}`);
  if (profile.housing_status) items.push(`주거: ${profile.housing_status}`);
  if (profile.employment_status) items.push(`취업 상태: ${profile.employment_status}`);
  if (profile.special_status?.length > 0) {
    items.push(`특수 지위: ${profile.special_status.join(', ')}`);
  }
  
  if (items.length === 0) return "";
  
  return `[지금까지 파악된 사용자 정보 (이전 대화에서 추출)]\n${items.join(' | ')}\n이 정보를 자격 매칭에 활용하되, 변경 가능성이 보이면 자연스럽게 재확인하세요.`;
}
