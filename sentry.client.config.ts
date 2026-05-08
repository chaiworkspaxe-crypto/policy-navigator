// sentry.client.config.ts
import * as Sentry from '@sentry/nextjs';
import { SHARED_SENTRY_INIT, COMMON_IGNORE } from './sentry.shared';

Sentry.init({
  ...SHARED_SENTRY_INIT,
  ignoreErrors: COMMON_IGNORE,
  // 클라이언트 전용 Replay 설정
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
});
