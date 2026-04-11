import { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://policyai.kr',
      lastModified: new Date(),
      changeFrequency: 'daily', // 매일 새로운 혜택이나 데이터가 업데이트될 수 있음을 알림
      priority: 1.0, // 가장 중요한 메인 페이지임을 강조 (0.0 ~ 1.0)
    },
    // 나중에 /admin 같은 관리자 페이지나 다른 페이지가 생기면 여기에 추가하면 돼!
  ];
}
