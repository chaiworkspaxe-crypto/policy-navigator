// next.config.ts
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig = {
  // 기존 Next.js 설정들...
};

export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT ?? 'policy-navigator-web',
  release: { name: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev' },
  authToken: process.env.SENTRY_AUTH_TOKEN,
  disableLogger: true,
  // 🌟 [신규] 자체 도메인 경유로 광고차단기 우회 (Tunneling)
  tunnelRoute: '/monitoring', 
});
