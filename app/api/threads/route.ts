// app/api/threads/route.ts — 전체 교체

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id 누락' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('chat_threads')
    .select('thread_id, title, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false }) // 🌟 created_at → updated_at: 최근 활동순
    .limit(100); // 🌟 무한 누적 방지

  if (error) {
    console.error('[GET /api/threads]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ threads: data ?? [] });
}

export async function POST(req: Request) {
  try {
    const { user_id } = await req.json();
    if (!user_id) {
      return NextResponse.json({ error: 'user_id 누락' }, { status: 400 });
    }
    const thread_id = uuidv4();
    const now = new Date().toISOString();

    const { error } = await supabase
      .from('chat_threads')
      .insert({ thread_id, user_id, title: '새 대화', created_at: now, updated_at: now });

    if (error) {
      console.error('[POST /api/threads]', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ thread_id });
  } catch (e: any) {
    console.error('[POST /api/threads] parse:', e);
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('user_id');
  const threadId = searchParams.get('thread_id');
  const deleteAll = searchParams.get('delete_all');

  if (!userId) {
    return NextResponse.json({ error: 'user_id 누락' }, { status: 400 });
  }

  let resp;
  if (deleteAll === 'true') {
    resp = await supabase.from('chat_threads').delete().eq('user_id', userId);
    // 메시지 / inputs 도 같이 정리 (cascade 안 걸려있으면 수동 정리)
    await supabase.from('chat_messages').delete().eq('user_id', userId);
    await supabase.from('chat_thread_inputs').delete().eq('user_id', userId);
  } else if (threadId) {
    resp = await supabase
      .from('chat_threads')
      .delete()
      .eq('user_id', userId)
      .eq('thread_id', threadId);
    await supabase
      .from('chat_messages')
      .delete()
      .eq('user_id', userId)
      .eq('thread_id', threadId);
    await supabase
      .from('chat_thread_inputs')
      .delete()
      .eq('user_id', userId)
      .eq('thread_id', threadId);
  } else {
    return NextResponse.json(
      { error: 'thread_id 또는 delete_all 중 하나는 필요' },
      { status: 400 },
    );
  }

  if (resp?.error) {
    console.error('[DELETE /api/threads]', resp.error);
    return NextResponse.json({ error: resp.error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
