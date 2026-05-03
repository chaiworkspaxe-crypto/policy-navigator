// app/api/messages/route.ts — 전체 교체

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const threadId = searchParams.get('thread_id');
  const userId = searchParams.get('user_id');

  // 🌟 입력 검증
  if (!threadId || !userId) {
    return NextResponse.json(
      { error: 'thread_id와 user_id가 모두 필요합니다.' },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from('chat_messages')
    .select('role, content, created_at')
    .eq('thread_id', threadId)
    .eq('user_id', userId) // 🌟 IDOR 방지
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[GET /api/messages]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ messages: data ?? [] });
}
