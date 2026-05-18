// app/api/policies/extract/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'edge';

/**
 * @deprecated 정책 자가 학습 기능은 Private 모드 폐기와 함께 비활성화되었습니다.
 * 재활성화하려면 chat/route.ts의 after()에서 호출부 복원이 필요합니다.
 */
export async function POST() {
  return NextResponse.json(
    { ok: false, reason: 'endpoint_disabled', note: '이 엔드포인트는 비활성화 상태입니다.' },
    { status: 410 }   // 410 Gone — 영구히 사라진 리소스
  );
}
