import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function GET() {
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
