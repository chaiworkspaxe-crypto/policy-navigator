import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// 🌟 관리자 권한 체크 헬퍼 함수
function checkAdmin(req: Request) {
  // TODO: 실제 서비스에서는 쿠키(Cookie)나 Authorization 헤더를 통한 토큰 검증 로직을 구현하세요.
  // 예: return req.headers.get('authorization') === `Bearer ${process.env.ADMIN_SECRET}`;
  
  // 현재 프론트엔드(AdminDashboard)에서 별도의 헤더 없이 호출하고 있으므로 임시로 true를 반환합니다.
  return true; 
}

export async function GET(req: Request) {
  // 🌟 관리자 권한 검증 적용
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // 1. 전체 유저 수 (중복 제거)
    const { count: userCount } = await supabase
      .from('chat_threads')
      .select('user_id', { count: 'exact', head: true });

    // 2. 전체 대화방 수
    const { count: threadCount } = await supabase
      .from('chat_threads')
      .select('*', { count: 'exact', head: true });

    // 3. 전체 메시지 수
    const { count: messageCount } = await supabase
      .from('chat_messages')
      .select('*', { count: 'exact', head: true });

    // 4. 최근 7일간 활성 유저 (예시 로직)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const { count: activeUserCount } = await supabase
      .from('chat_threads')
      .select('user_id', { count: 'exact', head: true })
      .gte('created_at', sevenDaysAgo.toISOString());

    return NextResponse.json({
      ok: true,
      data: {
        total_users: userCount || 0,
        total_threads: threadCount || 0,
        total_messages: messageCount || 0,
        active_users_7d: activeUserCount || 0,
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
