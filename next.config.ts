import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 🌟 외부 이미지 도메인 (OG 이미지, 향후 정책 카드 썸네일 등)
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'policyai.kr' },
    ],
  },
  // 🌟 React Strict Mode 명시 (Next.js 16 default true이지만 의도 표명)
  reactStrictMode: true,
  // 🌟 검색엔진 최적화: trailing slash 통일 안함 (default)
};

export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT ?? 'policy-navigator-web',
  release: { name: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev' },
  authToken: process.env.SENTRY_AUTH_TOKEN,
  disableLogger: true,
});
