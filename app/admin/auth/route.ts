// app/api/admin/auth/route.ts (신규)
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const { password } = await req.json();
  const adminKey = process.env.ADMIN_PASS_KEY;
  
  if (!adminKey || adminKey.length < 16) {
    return NextResponse.json({ ok: false, reason: 'admin disabled' }, { status: 503 });
  }
  
  // 상수 시간 비교 (timing attack 방지)
  const a = Buffer.from(password || '');
  const b = Buffer.from(adminKey);
  if (a.length !== b.length) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  
  // crypto.timingSafeEqual 사용
  const { timingSafeEqual } = await import('crypto');
  if (!timingSafeEqual(a, b)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  
  // httpOnly 쿠키 발급 (24시간)
  const res = NextResponse.json({ ok: true });
  res.cookies.set('admin_session', adminKey, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 60 * 60 * 24,
    path: '/',
  });
  return res;
}
