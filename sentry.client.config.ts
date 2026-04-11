import * as Sentry from "@sentry/nextjs";

Sentry.init({
  // 🌟 [주의] DSN은 Vercel 환경변수(SENTRY_DSN)로 넣을 거라 비워둬도 돼!
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN,
  traces_sample_rate: 1.0,
  debug: false,
});
