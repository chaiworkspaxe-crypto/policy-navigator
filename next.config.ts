import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 잘못된 옵션을 제거하여 터미널 경고(Warning)를 깔끔하게 없앱니다.
  // CORS는 백엔드(FastAPI)에서 컨트롤하는 것이 올바른 아키텍처입니다.
};

// Sentry 설정을 적용하여 내보냅니다.
export default withSentryConfig(nextConfig, {
  silent: true,
  org: "본인의_Sentry_조직명", // 🌟 Sentry 대시보드에서 확인한 조직명을 넣어줘!
  project: "policy-navigator-web",
});
