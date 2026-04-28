import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack이 빈 설정을 감지해서 충돌 에러를 무시하도록 강제하는 옵션!
  turbopack: {}, 
};

export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,            // Vercel 환경변수에서 조직명 로드
  project: process.env.SENTRY_PROJECT || "policy-navigator-web",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // 환경변수(토큰)가 없으면 빌드 시 불필요한 에러가 나지 않도록 플러그인 자동 비활성화
  disableServerWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
  disableClientWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
});
