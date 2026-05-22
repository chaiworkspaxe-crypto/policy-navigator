// lib/policies.ts
// ────────────────────────────────────────────────────────────
// 🌟 SEO 정책 페이지용 서버 전용 데이터 레이어
// app/policy/[slug]/page.tsx 와 app/sitemap.ts 에서 사용
// ────────────────────────────────────────────────────────────
import { getSupabase } from '@/lib/supabase';

const supabase = getSupabase();

// ── 타입 정의 ──────────────────────────────────────────────
export interface PolicyDetail {
  id: string;
  slug: string;
  title: string;
  provider: string;
  summary: string;
  category: string | null;
  url: string;
  deadline: string | null;
  is_active: boolean;
  source_type: string;
  age_min: number | null;
  age_max: number | null;
  region_sido: string | null;
  region_sigungu: string | null;
  household_types: string[] | null;
  last_seen_at: string | null;
}

export interface PolicyCard {
  slug: string;
  title: string;
  provider: string;
  summary: string;
  category: string | null;
  deadline: string | null;
}

// ── 공통 Select 절 ─────────────────────────────────────────
const DETAIL_COLUMNS = 'id, slug, title, provider, summary, category, url, deadline, is_active, source_type, age_min, age_max, region_sido, region_sigungu, household_types, last_seen_at';
const CARD_COLUMNS = 'slug, title, provider, summary, category, deadline';

// ── 단건 조회 (by slug) ────────────────────────────────────
export async function getPolicyBySlug(slug: string): Promise<PolicyDetail | null> {
  try {
    const { data, error } = await supabase
      .from('policies')
      .select(DETAIL_COLUMNS)
      .eq('slug', slug)
      .maybeSingle();

    if (error) {
      console.error('[getPolicyBySlug]', error.message);
      return null;
    }
    return data as PolicyDetail | null;
  } catch (e: any) {
    console.error('[getPolicyBySlug exception]', e?.message);
    return null;
  }
}

// ── 관련 정책 (같은 카테고리 or 같은 지역, 최대 6건) ───────
export async function getRelatedPolicies(
  policy: PolicyDetail,
  limit = 6,
): Promise<PolicyCard[]> {
  try {
    // 1차: 같은 카테고리 + 같은 지역
    let query = supabase
      .from('policies')
      .select(CARD_COLUMNS)
      .eq('is_active', true)
      .eq('source_type', 'public')
      .neq('id', policy.id)
      .limit(limit);

    if (policy.category) {
      query = query.eq('category', policy.category);
    }
    if (policy.region_sido) {
      query = query.eq('region_sido', policy.region_sido);
    }

    const { data, error } = await query;

    if (error || !data || data.length === 0) {
      // Fallback: 카테고리만으로
      if (policy.category) {
        const { data: fallback } = await supabase
          .from('policies')
          .select(CARD_COLUMNS)
          .eq('is_active', true)
          .eq('category', policy.category)
          .neq('id', policy.id)
          .limit(limit);
        return (fallback ?? []) as PolicyCard[];
      }
      return [];
    }

    return data as PolicyCard[];
  } catch {
    return [];
  }
}

// ── 사이트맵용 slug 목록 (페이지네이션) ─────────────────────
const SITEMAP_PAGE_SIZE = 2000;

export async function getSlugsForSitemap(page: number): Promise<{ slug: string; last_seen_at: string | null }[]> {
  try {
    const from = page * SITEMAP_PAGE_SIZE;
    const to = from + SITEMAP_PAGE_SIZE - 1;

    const { data, error } = await supabase
      .from('policies')
      .select('slug, last_seen_at')
      .eq('is_active', true)
      .eq('source_type', 'public')
      .not('slug', 'is', null)
      .order('slug', { ascending: true })
      .range(from, to);

    if (error) {
      console.error('[getSlugsForSitemap]', error.message);
      return [];
    }
    return (data ?? []) as { slug: string; last_seen_at: string | null }[];
  } catch {
    return [];
  }
}

export async function getSitemapPageCount(): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('policies')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .eq('source_type', 'public')
      .not('slug', 'is', null);

    if (error || count === null) return 1;
    return Math.ceil(count / SITEMAP_PAGE_SIZE);
  } catch {
    return 1;
  }
}

// ── 정책 목록 페이지용 (카테고리별, 페이지네이션) ─────────
const LIST_PAGE_SIZE = 30;

export async function getPolicyList(opts?: {
  page?: number;
  category?: string;
  region?: string;
}): Promise<{ policies: PolicyCard[]; totalCount: number }> {
  try {
    const page = opts?.page ?? 0;
    const from = page * LIST_PAGE_SIZE;
    const to = from + LIST_PAGE_SIZE - 1;

    let query = supabase
      .from('policies')
      .select(CARD_COLUMNS, { count: 'exact' })
      .eq('is_active', true)
      .eq('source_type', 'public')
      .not('slug', 'is', null);

    if (opts?.category) query = query.eq('category', opts.category);
    if (opts?.region) query = query.eq('region_sido', opts.region);

    query = query.order('last_seen_at', { ascending: false, nullsFirst: false }).range(from, to);

    const { data, count, error } = await query;

    if (error) {
      console.error('[getPolicyList]', error.message);
      return { policies: [], totalCount: 0 };
    }

    return {
      policies: (data ?? []) as PolicyCard[],
      totalCount: count ?? 0,
    };
  } catch {
    return { policies: [], totalCount: 0 };
  }
}

// ── 카테고리 목록 (서비스 분야) ─────────────────────────────
export async function getCategories(): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('policies')
      .select('category')
      .eq('is_active', true)
      .not('category', 'is', null)
      .not('category', 'eq', '');

    if (error || !data) return [];

    const unique = [...new Set(data.map((r: any) => r.category as string))].sort();
    return unique;
  } catch {
    return [];
  }
}

// ── 유틸: 마감 상태 판단 ────────────────────────────────────
export function getDeadlineStatus(deadline: string | null): {
  label: string;
  isExpired: boolean;
  dDay: number | null;
  urgency: 'expired' | 'urgent' | 'normal' | 'ongoing';
} {
  if (!deadline) {
    return { label: '상시모집', isExpired: false, dDay: null, urgency: 'ongoing' };
  }

  const t = Date.parse(deadline);
  if (Number.isNaN(t)) {
    return { label: '공고 확인 필요', isExpired: false, dDay: null, urgency: 'normal' };
  }

  const now = Date.now();
  const days = Math.ceil((t - now) / (24 * 3600_000));

  if (days < 0) {
    return { label: `마감됨`, isExpired: true, dDay: days, urgency: 'expired' };
  }
  if (days <= 7) {
    return { label: `D-${days} 🔥`, isExpired: false, dDay: days, urgency: 'urgent' };
  }
  // 날짜를 한국어 형식으로
  const d = new Date(t);
  const formatted = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  return { label: `~${formatted}`, isExpired: false, dDay: days, urgency: 'normal' };
}
