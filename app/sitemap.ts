import { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://policyai.kr';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL, // 🌟 구 도메인(Vercel) 삭제, 정식 도메인으로 교체 완벽 적용!
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
  ];
}
