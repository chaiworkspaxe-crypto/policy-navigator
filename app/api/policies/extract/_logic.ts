// app/api/policies/extract/_logic.ts
// ────────────────────────────────────────────────────────────
// 🌟 자가 학습형 RAG — Private 모드 답변에서 민간 혜택을 추출해 DB에 자동 저장
// 🛡️ 4단 방어: URL 정규화 → 정부 정책 차단 → 마감일 검증 → 스킴 화이트리스트
// ────────────────────────────────────────────────────────────
import { openai } from '@ai-sdk/openai';
import { generateObject, embed } from 'ai';
import { z } from 'zod';
import { getSupabase } from '@/lib/supabase';

const supabase = getSupabase();
const EXTRACT_MODEL = process.env.OPENAI_EXTRACT_MODEL ?? 'gpt-5.4-nano';
const EMBED_MODEL = 'text-embedding-3-small';

// ────────────────────────────────────────────────────────────
// 🛡️ 방어 계층 1: URL 정규화 — dedup 신뢰성의 근간
// ────────────────────────────────────────────────────────────
const SAFE_URL_RE = /^https?:\/\//i;
const TRACKING_PARAM_RE = /^(utm_|fbclid|gclid|igshid|ref$|source$|campaign$)/i;

function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());

    // 스킴 화이트리스트 — javascript:, ftp:, data: 등 차단
    if (!/^https?:$/i.test(u.protocol)) return null;

    u.hostname = u.hostname.toLowerCase();
    u.hash = ''; // fragment 제거 (#section 등)

    // 트래킹 파라미터 제거
    [...u.searchParams.keys()].forEach((k) => {
      if (TRACKING_PARAM_RE.test(k)) u.searchParams.delete(k);
    });

    // trailing slash 정규화 (path가 '/'만이면 보존)
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }

    return u.toString();
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────
// 🛡️ 방어 계층 2: 정부 정책 탐지 — Private DB 오염 방지 (격벽의 마지막 방어선)
// ────────────────────────────────────────────────────────────
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
  // 1) 정부 도메인이면 즉시 차단
  if (GOV_DOMAIN_RE.test(p.url)) return true;

  // 2) 정부 정책 키워드가 제목/주관/요약 어디에든 등장하면 차단
  const haystack = `${p.title} ${p.provider} ${p.summary}`;
  return GOV_POLICY_KEYWORDS.some(kw => haystack.includes(kw));
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
    .max(20) // 🛡️ 한 답변에서 20개 초과 추출은 환각 의심 → 잘라냄
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
5. 한 번에 최대 20개까지만 추출하세요.`,
      // 🛡️ [토큰 폭탄 방어] 답변이 아무리 길어도 8000자까지만 LLM에 전달
      prompt: `아래 텍스트에서 민간/기업 혜택 정보만 추출하세요:\n\n${text.slice(0, 8000)}`,
      maxRetries: 1, // 백그라운드 작업이므로 실패 시 오래 재시도하지 않음
    });
    object = result.object;
  } catch (e: any) {
    console.error('[extract policies LLM Error]', e);
    return { ok: false, reason: e?.message ?? 'llm_failed' };
  }

  const rawPolicies = object.policies;
  if (!rawPolicies || rawPolicies.length === 0) {
    return { ok: false, reason: 'no_valid_policies' };
  }

  // ────────────────────────────────────────────────
  // Step 2. 🛡️ 4단 방어 필터링 (LLM 출력을 절대 신뢰하지 않음)
  // ────────────────────────────────────────────────
  const filtered = rawPolicies
    // 1) URL 정규화 — UTM/fragment/trailing slash 차이로 인한 중복 저장 방지
    .map(p => ({ ...p, url: normalizeUrl(p.url) }))

    // 2) 유효 URL만 통과 (정규화 실패 = javascript:/ftp:/빈값/깨진 URL)
    .filter((p): p is typeof p & { url: string } => p.url !== null)

    // 3) 정부/공공 정책 차단 — Private DB 오염 방지 (격벽의 마지막 수비수)
    .filter(p => !isGovernmentPolicy(p))

    // 4) 마감일 범위 검증 — 과거/비정상 날짜 버림
    .filter(p => {
      if (!p.deadline) return true; // null = 상시모집 → OK

      const t = Date.parse(p.deadline);

      // 파싱 불가 → 환각 의심 → 버림
      if (Number.isNaN(t)) return false;

      // 이미 과거 → 만료 공고 → 버림
      if (t < now) return false;

      // 3년 이후 → 환각 의심 → 버림
      if (t > now + 3 * 365 * 24 * 3600_000) return false;

      return true;
    });

  if (filtered.length === 0) {
    console.log('[extract policies] 필터링 후 유효 항목 0건 (원본:', rawPolicies.length, '건)');
    return { ok: true, count: 0 };
  }

  console.log(`[extract policies] 필터링: ${rawPolicies.length}건 → ${filtered.length}건 통과`);

  // ────────────────────────────────────────────────
  // Step 3. 임베딩 생성 + DB Upsert (배치 병렬화, 동시성 3 제한)
  // ────────────────────────────────────────────────
  const CONCURRENCY = 3; // OpenAI 무료 요금 rate limit 방어
  let insertedCount = 0;

  for (let i = 0; i < filtered.length; i += CONCURRENCY) {
    const batch = filtered.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(async (policy) => {
        // 검색에 잘 걸리도록 제목과 요약을 합쳐서 임베딩
        const embedText = `[${policy.provider}] ${policy.title} - ${policy.summary}`;
        const { embedding } = await embed({
          model: openai.embedding(EMBED_MODEL),
          value: embedText,
        });

        // Supabase Upsert — 정규화된 URL 기준 dedup
        const { error } = await supabase
          .from('policies')
          .upsert({
            title: policy.title,
            provider: policy.provider,
            summary: policy.summary,
            url: policy.url,           // ✅ 정규화 완료된 URL
            deadline: policy.deadline,  // ✅ 유효 검증 완료된 마감일
            embedding: embedding,
            source_type: 'private',     // 🌟 민간 데이터 태그
            last_seen_at: new Date().toISOString(), // 🌟 라이프사이클 추적 (클린업 cron 기반)
          }, {
            onConflict: 'url',          // URL 같으면 기존 데이터 덮어쓰기(갱신)
          });

        if (error) {
          throw new Error(`[Upsert] ${policy.title}: ${error.message}`);
        }
        return true;
      })
    );

    // 배치 결과 집계
    for (const r of results) {
      if (r.status === 'fulfilled') {
        insertedCount++;
      } else {
        console.error('[extract policies batch error]', r.reason);
      }
    }
  }

  console.log(`[extract policies] DB 저장 완료: ${insertedCount}/${filtered.length}건`);
  return { ok: true, count: insertedCount };
}
