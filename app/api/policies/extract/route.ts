// app/api/policies/extract/route.ts
// ────────────────────────────────────────────────────────────
// 얇은 HTTP 래퍼 — 모든 핵심 로직은 _logic.ts에 위임
// 이 파일은 외부(or 내부) HTTP 엔드포인트로만 존재하며,
// chat/route.ts의 after()에서는 _logic.ts를 직접 호출합니다.
// ────────────────────────────────────────────────────────────
import { NextResponse } from 'next/server';
import { extractPoliciesCore } from './_logic';
import * as Sentry from '@sentry/nextjs';

export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    // 🛡️ 내부 API 호출인지 검증 (보안)
    const internalSecret = req.headers.get('x-internal-secret');
    if (internalSecret !== process.env.INTERNAL_API_SECRET) {
      return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const result = await extractPoliciesCore({ text: (body as any).text });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Policy Extract Route Error]', error);
    Sentry.captureException(error);
    return NextResponse.json({ ok: false, reason: 'internal_error' }, { status: 500 });
  }
}
