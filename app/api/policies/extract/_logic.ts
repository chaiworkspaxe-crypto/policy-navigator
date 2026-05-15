// app/api/policies/extract/_logic.ts
// ────────────────────────────────────────────────────────────
// 🌟 자가 학습형 RAG — Private 모드 답변에서 민간 혜택을 추출해 DB에 자동 저장
// 🛡️ 고도화: Quality-aware Upsert, Embedding Retry, 텍스트 양방향 샘플링
// ────────────────────────────────────────────────────────────
import { openai } from '@ai-sdk/openai';
import { generateObject, embed } from 'ai';
import { z } from 'zod';
import { getSupabase } from '@/lib/supabase';

const supabase = getSupabase();
const EXTRACT_MODEL = process.env.OPENAI_EXTRACT_MODEL ?? 'gpt-5.4-nano';
const EMBED_MODEL = 'text-embedding-3-small';

// ────────────────────────────────────────────────────────────
// 🛡️ 유틸리티: URL 정규화 & 정부 정책 차단
// ────────────────────────────────────────────────────────────
const SAFE_URL_RE = /^https?:\/\//i;
const TRACKING_PARAM_RE = /^(utm_|fbclid|gclid|igshid|ref$|source$|campaign$)/i;

function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (!/^https?:$/i.test(u.protocol)) return null;

    u.hostname = u.hostname.toLowerCase();
    u.hash = '';

    [...u.searchParams.keys()].forEach((k) => {
      if (TRACKING_PARAM_RE.test(k)) u.searchParams.delete(k);
    });

    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return null;
  }
}

const GOV_DOMAIN_RE = /\.(go\.kr|or\.kr|gov\.kr)(\/|$)/i;
const GOV_POLICY_KEYWORDS = [
  '청년도약계좌', '청년희망적금', '내일채움공제', '청년내일채움',
  'LH 전세임대', 'LH전세', '버팀목 전세', '디딤돌 대출', '디딤돌대출',
  '국민취업지원제도', '국민기초생활', '기초연금', '근로장려금',
  '주거급여', '생계급여', '의료급여', '교육급여',
  '긴급복지', '기초생활수급', '차상위', '한부모가족지원',
  '국민연금', '고용보험', '산재보험', '건강보험',
];

function isGovernmentPolicy(p: { title: string; provider: string; url: string; summary: string }): boolean {
  if (GOV_DOMAIN_RE.test(p.url)) return true;
  const haystack = `${p.title} ${p.provider} ${p.summary}`;
  return GOV_POLICY_KEYWORDS.some(kw => haystack.includes(kw));
}

// ────────────────────────────────────────────────────────────
// 🌟 [신규 유틸] 품질 평가 & 텍스트 샘플링 & 안전한 임베딩
// ────────────────────────────────────────────────────────────

// 텍스트 청크화 — 8000자 초과 시 앞/뒤 양쪽 샘플링 (긴 답변 누락 방지)
function sampleTextForExtraction(text: string, maxLen = 8000): string {
  if (text.length <= maxLen) return text;
  const half = Math.floor(maxLen / 2);
  return text.slice(0, half) + 
    `\n\n…[중간 생략 — 답변이 길어 앞뒤만 추출함]…\n\n` + 
    text.slice(-half);
}

// 추출된 정책 품질 점수 계산
function policyQualityScore(p: {
  title: string; provider: string; summary: string; deadline: string | null;
}): number {
  let score = 0;
  score += Math.min(p.title?.length || 0, 60);
  score += Math.min(p.provider?.length || 0, 40);
  score += Math.min(p.summary?.length || 0, 200); // 요약 길이가 가장 큰 가중치
  if (p.deadline) score += 30; // 마감일이 명확하면 보너스
  return score;
}

// 임베딩 with 재시도 (실패 시 null 반환하여 정책 텍스트라도 저장)
async function safeEmbed(text: string): Promise<number[] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { embedding } = await embed({
        model: openai.embedding(EMBED_MODEL),
        value: text,
      });
      if (Array.isArray(embedding) && embedding.length > 0) return embedding;
    } catch (e: any) {
      console.warn(`[embed retry ${attempt + 1}]`, e?.message);
      if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// 스키마 정의 (Zod)
// ────────────────────────────────────────────────────────────
export const ExtractedPoliciesSchema = z.object({
  policies: z.array(
    z.object({
      title: z.string().min(2).max(120).describe('정책 또는 부트캠프/지원금의 이름'),
      provider: z.string().min(1).max(80).describe('주관하는 기업명 또는 재단명'),
      summary: z.string().min(10).max(400).describe('지원 대상, 혜택, 자격 조건 등을 100자 이내로 요약'),
      url: z.string()
        .refine(v => SAFE_URL_RE.test(v), { message: 'http(s) 스킴만 허용됩니다.' })
        .describe('반드시 http/https로 시작하는 공식 링크'),
      deadline: z.string().datetime().nullable().describe(
        '마감일이 있다면 YYYY-MM-DDTHH:mm:ssZ (ISO 8601) 형식. 상시모집이거나 알 수 없으면 null'
      ),
    })
  )
  // 🌟 LLM이 미쳐서 25개 뱉었다고 전체 파싱을 죽이지 않기 위해 .max(20) 제거. 로직에서 슬라이스함.
  .describe('추출된 정책 리스트. URL이 없거나 "..."으로 잘린 불확실한 항목은 절대 포함하지 마세요.'),
});

// ────────────────────────────────────────────────────────────
// 핵심 로직
// ────────────────────────────────────────────────────────────
export type PolicyExtractResult =
  | { ok: true; count: number }
  | { ok: false; reason: string };

export async function extractPoliciesCore(args: { text: string }): Promise<PolicyExtractResult> {
  const { text } = args;
  if (!text || text.length < 100) return { ok: false, reason: 'too_short' };

  const now = Date.now();

  // ────────────────────────────────────────────────
  // Step 1. LLM으로 JSON 추출
  // ────────────────────────────────────────────────
  let object: z.infer<typeof ExtractedPoliciesSchema>;
  try {
    const result = await generateObject({
      model: openai(EXTRACT_MODEL),
      schema: ExtractedPoliciesSchema,
      system: `당신은 AI가 작성한 정책 안내 텍스트에서 데이터베이스 삽입용 JSON을 추출하는 데이터 엔지니어입니다.
[엄격 규칙]
1. URL이 없거나 '...' 등으로 잘려있는 불확실한 혜택은 무조건 버리세요.
2. 정부/지자체/공공기관 정책(LH/HUG/청년도약계좌/내일채움 등)은 민간이 아니므로 제외하세요.
3. deadline(마감일)은 정확한 날짜가 명시된 경우만 ISO 포맷(YYYY-MM-DDTHH:mm:ssZ)으로 변환하고, 모호하면 null을 넣으세요.
4. URL은 반드시 http:// 또는 https://로 시작해야 합니다.
5. 한 번에 최대 20개까지만 추출하세요. 21개 이상은 만들지 마세요.`,
      // 🌟 [핵심 변경] 8000자 초과 시 앞뒤 샘플링
      prompt: `아래 텍스트에서 민간/기업 혜택 정보만 추출하세요. 최대 20개:\n\n${sampleTextForExtraction(text, 8000)}`,
      maxRetries: 1, 
    });
    object = result.object;
  } catch (e: any) {
    console.error('[extract policies LLM Error]', e);
    return { ok: false, reason: e?.message ?? 'llm_failed' };
  }

  // 🌟 LLM이 지시를 어기고 20개를 초과할 경우 안전하게 자름
  const rawPolicies = (object.policies || []).slice(0, 20);
  
  if (rawPolicies.length === 0) {
    return { ok: false, reason: 'no_valid_policies' };
  }

  // ────────────────────────────────────────────────
  // Step 2. 🛡️ 4단 방어 필터링
  // ────────────────────────────────────────────────
  const filtered = rawPolicies
    .map(p => ({ ...p, url: normalizeUrl(p.url) }))
    .filter((p): p is typeof p & { url: string } => p.url !== null)
    .filter(p => !isGovernmentPolicy(p))
    .filter(p => {
      if (!p.deadline) return true; 
      const t = Date.parse(p.deadline);
      if (Number.isNaN(t)) return false;
      if (t < now) return false;
      if (t > now + 3 * 365 * 24 * 3600_000) return false;
      return true;
    });

  if (filtered.length === 0) {
    return { ok: true, count: 0 };
  }

  // ────────────────────────────────────────────────
  // Step 3. 🌟 Quality-aware 결정 (풍부할 때만 덮어쓰기)
  // ────────────────────────────────────────────────
  const filteredUrls = filtered.map((p) => p.url);
  const { data: existingRows } = await supabase
    .from('policies')
    .select('url, title, provider, summary, deadline, embedding')
    .in('url', filteredUrls);

  const existingByUrl = new Map<string, any>();
  (existingRows ?? []).forEach((r: any) => existingByUrl.set(r.url, r));

  const toInsert: typeof filtered = [];
  const toSkip: string[] = [];
  const toEmbedOnly: typeof filtered = []; 

  for (const p of filtered) {
    const existing = existingByUrl.get(p.url);
    if (!existing) {
      toInsert.push(p);
      continue;
    }
    const newScore = policyQualityScore(p);
    const oldScore = policyQualityScore(existing);
    
    // 새 추출이 명백히 풍부할 때만(10점 이상 차이) 덮어쓰기
    if (newScore > oldScore + 10) {
      toInsert.push(p);
    } else if (!existing.embedding) {
      // 기존 내용은 유지하되 임베딩이 없으면 보강
      toEmbedOnly.push(p);
    } else {
      // 기존 데이터가 더 훌륭함 -> 덮어쓰지 않고 생략
      toSkip.push(p.title);
    }
  }

  // ────────────────────────────────────────────────
  // Step 4. 배치 처리 + 임베딩 생성 (실패 허용)
  // ────────────────────────────────────────────────
  const CONCURRENCY = 3; 
  let insertedCount = 0;

  const writeOne = async (policy: typeof filtered[number], mode: 'full' | 'embed-only') => {
    const embedText = `[${policy.provider || '주관기관 미상'}] ${policy.title} - ${policy.summary}`;
    // 🌟 안전한 임베딩 (실패 시 null)
    const embedding = await safeEmbed(embedText);

    if (mode === 'full') {
      const { error } = await supabase
        .from('policies')
        .upsert({
          title: policy.title,
          provider: policy.provider,
          summary: policy.summary,
          url: policy.url,
          deadline: policy.deadline,
          embedding: embedding, // null이어도 저장됨!
          source_type: 'private',
          last_seen_at: new Date().toISOString(),
        }, { onConflict: 'url' });
      if (error) throw new Error(`[Upsert] ${policy.title}: ${error.message}`);
    } else {
      const { error } = await supabase
        .from('policies')
        .update({
          embedding: embedding,
          last_seen_at: new Date().toISOString(),
        })
        .eq('url', policy.url);
      if (error) throw new Error(`[EmbedOnly] ${policy.title}: ${error.message}`);
    }
    return true;
  };

  const tasks: Array<{ p: typeof filtered[number]; mode: 'full' | 'embed-only' }> = [
    ...toInsert.map((p) => ({ p, mode: 'full' as const })),
    ...toEmbedOnly.map((p) => ({ p, mode: 'embed-only' as const })),
  ];

  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const batch = tasks.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(({ p, mode }) => writeOne(p, mode)));
    
    for (const r of results) {
      if (r.status === 'fulfilled') insertedCount++;
      else console.error('[extract policies batch error]', r.reason);
    }
  }

  // 🌟 Skip된(기존 데이터가 더 좋아서 무시된) 레코드도 "방금 또 발견됨" 신호로 시간만 갱신
  if (toSkip.length > 0) {
    const skipUrls = filtered.filter(p => toSkip.includes(p.title)).map(p => p.url);
    void supabase
      .from('policies')
      .update({ last_seen_at: new Date().toISOString() })
      .in('url', skipUrls)
      .then(({ error }) => {
        if (error) console.error('[skip timestamp update err]', error.message);
      });
  }

  console.log(`[extract policies] DB 저장: ${insertedCount}/${tasks.length}건, skip=${toSkip.length}`);
  return { ok: true, count: insertedCount };
}
