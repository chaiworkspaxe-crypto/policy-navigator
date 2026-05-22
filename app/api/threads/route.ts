// app/api/threads/route.ts

import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';

export const runtime = 'edge';

const supabase = getSupabase();

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
    .order('updated_at', { ascending: false }) // 최근 활동순
    .limit(100); // 무한 누적 방지

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
    
    // user_id 포맷 검증 (IDOR 방어)
    if (!/^user_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user_id)) {
      return NextResponse.json({ error: 'invalid user_id' }, { status: 400 });
    }

    const thread_id = uuidv4();
    const now = new Date().toISOString();

    // 1️⃣ [필수] 부모 테이블(chat_threads)에 방을 먼저 생성 (동기적 순서 보장)
    const threadResult = await supabase.from('chat_threads').insert({
      thread_id, 
      user_id, 
      title: '새 대화', 
      created_at: now, 
      updated_at: now,
    });

    // 🛡️ 부모방 생성 실패 시 자식 로직으로 넘어가지 못하게 즉시 차단
    if (threadResult.error) {
      console.error('[POST /api/threads]', threadResult.error);
      return NextResponse.json({ error: threadResult.error.message }, { status: 500 });
    }

    // 2️⃣ [필수] 부모 생성이 완료된 후, 자식 테이블(chat_thread_inputs) 초기화 진행
    const inputsResult = await supabase.from('chat_thread_inputs').insert({
      thread_id, 
      user_id, 
      updated_at: now,
    });

    if (inputsResult.error) {
      // inputs 실패는 비치명적 에러 로그 처리 — 첫 chat에서 upsert로 자연 복구됨
      console.error('[POST /api/threads inputs init]', inputsResult.error);
    }

    // 프론트엔드 호환성을 위해 원본 객체 구조 유지
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
  if (deleteAll !== 'true' && !threadId) {
    return NextResponse.json(
      { error: 'thread_id 또는 delete_all 중 하나는 필요' },
      { status: 400 },
    );
  }

  // 부모 thread만 지우면 DB의 ON DELETE CASCADE가 자식 테이블을 자동 정리함
  const isAll = deleteAll === 'true';
  let q = supabase.from('chat_threads').delete().eq('user_id', userId);
  
  if (!isAll) {
    q = q.eq('thread_id', threadId!);
  }

  const { error } = await q;

  if (error) {
    console.error('[DELETE /api/threads]', error);
    return NextResponse.json(
      { error: `삭제 실패: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
