import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack이 빈 설정을 감지해서 충돌 에러를 무시하도록 강제하는 옵션!
  turbopack: {}, 
};

export default withSentryConfig(nextConfig, {
  silent: true,
  org: "본인의_Sentry_조직명", // 아까 넣었던 조직명 그대로 유지해줘
  project: "policy-navigator-web",
});
