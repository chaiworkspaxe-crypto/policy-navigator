import * as Sentry from "@sentry/nextjs";

Sentry.init({
  // 서버 사이드이므로 SENTRY_DSN을 우선적으로 찾고, 없으면 NEXT_PUBLIC_SENTRY_DSN 사용
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1, // 🌟 서버 사이드 트레이싱 비율을 10%로 낮춰 비용 폭탄 방지
  debug: false,
});
