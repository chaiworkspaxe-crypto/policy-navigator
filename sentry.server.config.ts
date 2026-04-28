import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN,
  tracesSampleRate: 0.1, // 🌟 서버 사이드 트레이싱 비율을 10%로 낮춰 비용 폭탄 방지
  debug: false,
});
