import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack이 빈 설정을 감지해서 충돌 에러를 무시하도록 강제하는 옵션!
  turbopack: {}, 
  
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            // 🌟 수정됨: 외부 도메인(https:)과 데이터 URI(data:)도 허용하도록 완화
            value: "script-src 'self' 'unsafe-eval' 'unsafe-inline' https: data:;",
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  org: "본인의_Sentry_조직명", 
  project: "policy-navigator-web",
});
