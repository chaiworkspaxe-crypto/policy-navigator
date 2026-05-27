// app/sitemap.ts
import type { MetadataRoute } from 'next';
import { getSupabase } from '@/lib/supabase';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://policyai.kr';

export const revalidate = 86400; // 24시간마다 갱신

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    // 🌟 지역별 랜딩페이지
    {
      url: `${SITE_URL}/policies/region`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    ...['서울특별시','부산광역시','대구광역시','인천광역시','광주광역시','대전광역시','울산광역시','세종특별자치시','경기도','강원특별자치도','충청북도','충청남도','전북특별자치도','전라남도','경상북도','경상남도','제주특별자치도']
      .map(sido => ({
        url: `${SITE_URL}/policies/region/${encodeURIComponent(sido)}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      })),
  ];

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('policies')
      .select('slug, last_seen_at')
      .eq('is_active', true)
      .eq('source_type', 'public')
      .not('slug', 'is', null)
      .order('slug', { ascending: true });

    if (!error && data) {
      for (const row of data) {
        entries.push({
          url: `${SITE_URL}/policy/${encodeURIComponent(row.slug)}`,
          lastModified: row.last_seen_at ? new Date(row.last_seen_at) : new Date(),
          changeFrequency: 'weekly',
          priority: 0.7,
        });
      }
    }
  } catch (e) {
    console.error('[sitemap] Error fetching policies:', e);
  }

  return entries;
}
