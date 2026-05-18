// app/api/policies/extract/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function POST() {
  return NextResponse.json(
    { ok: false, reason: 'endpoint_disabled', note: '이 엔드포인트는 비활성화 상태입니다.' },
    { status: 410 }   // 410 Gone — 영구히 사라진 리소스
  );
}
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
