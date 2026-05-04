import { MetadataRoute } from 'next';

// 🌟 운영 도메인 단일 소스 (환경 변수 또는 기본값)
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://policyai.kr';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { 
        userAgent: '*', 
        allow: '/', 
        disallow: '/admin/' // 🌟 관리자 테스트 페이지는 구글 노출 차단
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL, // 🌟 한국 검색엔진(네이버 등) 호스트 정규화에 매우 유리함
  };
}
