// next.config.ts
import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://*.sentry.io ${process.env.NODE_ENV === 'development' ? "'unsafe-eval'" : ""};
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https:;
  font-src 'self' data:;
  connect-src 'self' https://www.google-analytics.com https://*.sentry.io https://*.supabase.co https://api.openai.com https://api.tavily.com https://openapi.naver.com;
  frame-src 'none';
  frame-ancestors 'self';
  base-uri 'self';
  form-action 'self';
  object-src 'none';
  upgrade-insecure-requests;
`.replace(/\s{2,}/g, ' ').trim(); // 줄바꿈과 여러 칸의 공백을 한 칸으로 압축

const nextConfig: NextConfig = {
  // 🌟 [해결 완료] Sentry가 강제로 주입하는 webpack 설정과 Next.js 16의 충돌을 방지하기 위한 안심 부적!
  turbopack: {},
  
  // 🌟 외부 이미지 도메인 (OG 이미지, 향후 정책 카드 썸네일 등)
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'policyai.kr' },
    ],
  },
  // 🌟 React Strict Mode 명시 (Next.js 16 default true이지만 의도 표명)
  reactStrictMode: true,

  // 🌟 [추가 권장 8-2] poweredByHeader 제거 — Next.js 노출 정보 최소화
  poweredByHeader: false,
  
  // 🌟 [추가 권장 8-2] 보안 헤더 — 정책 정보를 다루는 사이트인 만큼 기본 보안 강화
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // 🌟 [신규] HSTS — HTTPS 강제 (중간자 공격 방지)
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          // 🌟 [신규] CSP — XSS 공격 브라우저 단에서 이중 차단 (Defense-in-depth)
          {
            key: 'Content-Security-Policy',
            value: cspHeader,
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT ?? 'policy-navigator-web',
  release: { name: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev' },
  authToken: process.env.SENTRY_AUTH_TOKEN,
  disableLogger: true,
});
