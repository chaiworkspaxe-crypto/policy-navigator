import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { password } = await req.json();
    const adminKey = process.env.ADMIN_PASS_KEY;
    
    // 🌟 비밀번호가 4자 이상만 되면 허용하도록 변경 (8011 사용 가능!)
    if (!adminKey || adminKey.length < 4) {
      return NextResponse.json({ ok: false, reason: 'admin disabled' }, { status: 503 });
    }
    
    // 비밀번호 비교
    if (password === adminKey) {
      const res = NextResponse.json({ ok: true });
      
      // httpOnly 쿠키 발급 (24시간)
      res.cookies.set('admin_session', adminKey, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        maxAge: 60 * 60 * 24,
        path: '/',
      });
      return res;
    }

    return NextResponse.json({ ok: false }, { status: 401 });
  } catch (err) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
