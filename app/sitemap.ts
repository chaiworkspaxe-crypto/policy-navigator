// app/sitemap.ts
// ────────────────────────────────────────────────────────────
// 🌟 동적 멀티파트 사이트맵 — 14,000+ 정책 페이지를 2,000개씩 분할
// Next.js App Router의 generateSitemaps()로 사이트맵 인덱스 자동 생성
// /sitemap/0.xml, /sitemap/1.xml, ... → /sitemap.xml (인덱스)
// ────────────────────────────────────────────────────────────
import type { MetadataRoute } from 'next';
import { getSlugsForSitemap, getSitemapPageCount } from '@/lib/policies';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://policyai.kr';

// ── 사이트맵 파트 개수 결정 (빌드 시 한 번 호출) ────────────
export async function generateSitemaps() {
  const count = await getSitemapPageCount();
  // id: 0 은 정적 페이지용으로 예약
  // id: 1 ~ count 는 정책 페이지
  return Array.from({ length: count + 1 }, (_, i) => ({ id: i }));
}

// ── 각 파트의 URL 목록 반환 ─────────────────────────────────
export default async function sitemap(
  { id }: { id: number }
): Promise<MetadataRoute.Sitemap> {

  // id=0: 정적 페이지 (홈 등)
  if (id === 0) {
    return [
      {
        url: SITE_URL,
        lastModified: new Date(),
        changeFrequency: 'daily',
        priority: 1.0,
      },
    ];
  }

  // id=1~N: 정책 페이지 (2,000건씩)
  const policyPage = id - 1; // 0-indexed
  const slugs = await getSlugsForSitemap(policyPage);

  return slugs.map((row) => ({
    url: `${SITE_URL}/policy/${encodeURIComponent(row.slug)}`,
    lastModified: row.last_seen_at ? new Date(row.last_seen_at) : new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));
}
