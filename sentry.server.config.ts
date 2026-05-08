// sentry.server.config.ts
import * as Sentry from '@sentry/nextjs';
import { SHARED_SENTRY_INIT, COMMON_IGNORE } from './sentry.shared';

Sentry.init({
  ...SHARED_SENTRY_INIT,
  ignoreErrors: COMMON_IGNORE,
});
