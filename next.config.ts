import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack이 빈 설정을 감지해서 충돌 에러를 무시하도록 강제하는 옵션!
  turbopack: {}, 
};

export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT || "policy-navigator-web",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // 🌟 에러를 발생시키던 옛날 옵션(disableServerWebpackPlugin 등) 삭제 완료!
});
