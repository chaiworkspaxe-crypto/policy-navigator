import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack이 빈 설정을 감지해서 충돌 에러를 무시하도록 강제하는 옵션!
  turbopack: {}, 
};

// 🌟 [핵심 로직 추가] Sentry 환경변수가 모두 존재할 때만 Sentry 활성화
const sentryEnabled = !!process.env.SENTRY_AUTH_TOKEN && !!process.env.SENTRY_ORG;

export default sentryEnabled 
  ? withSentryConfig(nextConfig, {
      silent: true,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT || "policy-navigator-web",
      authToken: process.env.SENTRY_AUTH_TOKEN,
      // (에러를 발생시키던 disableServerWebpackPlugin 등 옛날 옵션은 이미 삭제됨)
    })
  : nextConfig; // 토큰이 없으면 순정 Next.js 설정만 그대로 내보냄 (빌드 에러 완벽 차단!)
