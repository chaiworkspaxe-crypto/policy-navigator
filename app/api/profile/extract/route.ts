// app/api/profile/extract/route.ts
import { NextResponse } from 'next/server';
import { extractProfileCore } from './_logic';

export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    
    // 🌟 핵심 로직(_logic.ts)으로 데이터 토스!
    const result = await extractProfileCore({
      userId: body.userId,
      threadId: body.threadId,
      lastUserMessage: body.lastUserMessage,
    });
    
    // 에러 발생 시 처리
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, reason: result.reason },
        { status: result.reason === 'missing fields' ? 400 : 500 },
      );
    }
    
    // 성공 시 추출된 프로필과 AI의 판단 근거(reasoning) 반환
    return NextResponse.json({ 
      ok: true, 
      profile: result.profile, 
      reasoning: result.reasoning 
    });
    
  } catch (e: any) {
    console.error('[extract profile route]', e);
    return NextResponse.json(
      { ok: false, reason: e?.message ?? 'unknown' }, 
      { status: 500 }
    );
  }
}
