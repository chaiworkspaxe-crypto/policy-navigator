// sentry.shared.ts
export const SHARED_SENTRY_INIT = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  // 트래픽 비용 제어 — 운영은 10%만 샘플링
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  debug: false,
} as const;

// 🌟 향후 쓸데없는 에러(노이즈)를 Sentry에서 걸러내기 위한 공통 필터
export const COMMON_IGNORE = [
  /AbortError/i,                 // 사용자 측 스트림 강제 중지
  /aborted/i,                    // 워치독 및 기타 네트워크 abort
  /canceled/i,                   // 취소된 요청
  /Failed to fetch/i,            // 단순 네트워크 깜빡임
];
