import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: '/admin/', // 🌟 관리자 테스트 페이지는 구글에 노출 안 되게 차단!
    },
    sitemap: 'https://policy-navigator-lac.vercel.app/sitemap.xml',
  }
}
