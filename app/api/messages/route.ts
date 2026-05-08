// app/api/messages/route.ts

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// 🛡️ 운영 안전 한계치 설정
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const threadId = searchParams.get('thread_id');
  const userId = searchParams.get('user_id');
  const before = searchParams.get('before'); // ISO timestamp, 더 과거 메시지 페치용
  const limitRaw = Number(searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Math.min(Math.max(1, Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT), MAX_LIMIT);

  // 🌟 입력 검증
  if (!threadId || !userId) {
    return NextResponse.json(
      { error: 'thread_id와 user_id가 모두 필요합니다.' },
      { status: 400 },
    );
  }

  // 🌟 커서 기반 페이지네이션: 'before' 있으면 그 시간 이전 메시지를 N개. 없으면 최신 N개.
  let q = supabase
    .from('chat_messages')
    .select('role, content, created_at')
    .eq('thread_id', threadId)
    .eq('user_id', userId) // 🌟 IDOR 공격 방어
    .order('created_at', { ascending: false }) // 최신 데이터부터 limit만큼 자름
    .limit(limit);

  if (before) q = q.lt('created_at', before);

  const { data, error } = await q;

  if (error) {
    console.error('[GET /api/messages]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  
  // 🛡️ UI 표시는 과거 -> 최신 (시간 오름차순)이 자연스러우므로 다시 뒤집어줌
  const messages = (data ?? []).reverse();
  
  // 🌟 다음 페이지용 커서 (가장 오래된 메시지의 시간 기록)
  const nextBefore = messages.length === limit && messages[0]
    ? messages[0].created_at
    : null;

  return NextResponse.json({ messages, nextBefore });
}
