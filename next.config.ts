// next.config.ts — 전체 교체

import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  turbopack: {},
  // 🌟 OG 이미지 호스트 등 외부 이미지 사용 시
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'policyai.kr' }],
  },
};

export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  org: process.env.SENTRY_ORG, // 🌟 env로 분리
  project: process.env.SENTRY_PROJECT ?? 'policy-navigator-web',
  // 🌟 release 자동 태깅 (Vercel 환경변수 활용)
  release: { name: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev' },
  // 🌟 인증토큰 누락 시 빌드 안 깨지게
  authToken: process.env.SENTRY_AUTH_TOKEN,
  disableLogger: true,
});
