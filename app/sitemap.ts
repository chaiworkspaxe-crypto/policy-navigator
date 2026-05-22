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
