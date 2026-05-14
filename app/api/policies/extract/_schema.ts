// app/api/policies/extract/_schema.ts (신규)
import { z } from 'zod';

// 🛡️ 정부 정책 키워드 — Private DB 오염 방지 (도메인 격벽의 마지막 방어선)
const GOV_POLICY_KEYWORDS = [
  '청년도약계좌', '청년희망적금', '내일채움공제', '청년내일채움',
  'LH 전세임대', 'LH전세', '버팀목 전세', '디딤돌 대출',
  '국민취업지원제도', '국민기초생활', '기초연금', '근로장려금',
  '주거급여', '생계급여', '의료급여', '교육급여',
];

const GOV_DOMAIN_RE = /\.(go\.kr|or\.kr|gov\.kr)(?:\/|$)/i;
const SAFE_URL_RE = /^https?:\/\//i;

// 🛡️ URL 정규화 — dedup 신뢰성의 근간
export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (!/^https?:$/i.test(u.protocol)) return null; // 스킴 화이트리스트
    
    u.hostname = u.hostname.toLowerCase();
    u.hash = ''; // fragment 제거
    
    // 트래킹 파라미터 제거
    const TRACKING = /^(utm_|fbclid|gclid|igshid|ref|source|campaign$)/i;
    [...u.searchParams.keys()].forEach((k) => {
      if (TRACKING.test(k)) u.searchParams.delete(k);
    });
    
    // trailing slash 정규화 (단, path가 '/'만이면 보존)
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    
    return u.toString();
  } catch {
    return null;
  }
}

// 🛡️ Private DB에 들어가면 안 되는 정부성 정책 탐지
export function isGovernmentPolicy(policy: { title: string; provider: string; url: string; summary: string }): boolean {
  // 1) 정부 도메인
  if (GOV_DOMAIN_RE.test(policy.url)) return true;
  
  // 2) 정부 정책 키워드 — 제목/주관/요약 어디든 등장하면 차단
  const haystack = `${policy.title} ${policy.provider} ${policy.summary}`;
  return GOV_POLICY_KEYWORDS.some(kw => haystack.includes(kw));
}

export const ExtractedPoliciesSchema = z.object({
  policies: z.array(
    z.object({
      title: z.string().min(2).max(120),
      provider: z.string().min(1).max(80),
      summary: z.string().min(10).max(400),
      url: z.string().refine(v => SAFE_URL_RE.test(v), {
        message: 'http(s) 스킴만 허용됩니다.',
      }),
      deadline: z.string().datetime().nullable(),
    })
  ).max(20), // 한 답변에서 20개 초과는 환각 의심
});
