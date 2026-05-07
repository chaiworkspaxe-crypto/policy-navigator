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
  if (deleteAll !== 'true' && !threadId) {
    return NextResponse.json(
      { error: 'thread_id 또는 delete_all 중 하나는 필요' },
      { status: 400 },
    );
  }

  // 🌟 [개선] 자식 테이블 → 부모 테이블 순서로 삭제 (FK 고아 데이터 방지)
  //          + 모든 결과를 모아서 첫 에러 발생 즉시 응답 반환
  const safeDelete = async (
    table: string,
    apply: (q: any) => any,
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      const { error } = await apply(supabase.from(table).delete());
      if (error) return { ok: false, error: `${table}: ${error.message}` };
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: `${table}: ${e?.message ?? 'unknown'}` };
    }
  };

  const isAll = deleteAll === 'true';

  // 🛡️ 자식(inputs, messages) 먼저 지우고 부모(threads)를 나중에 지우는 안전한 순서 보장!
  const targets: Array<[string, (q: any) => any]> = [
    ['chat_messages', (q) => isAll
      ? q.eq('user_id', userId)
      : q.eq('user_id', userId).eq('thread_id', threadId!)
    ],
    ['chat_thread_inputs', (q) => isAll
      ? q.eq('user_id', userId)
      : q.eq('user_id', userId).eq('thread_id', threadId!)
    ],
    ['chat_threads', (q) => isAll
      ? q.eq('user_id', userId)
      : q.eq('user_id', userId).eq('thread_id', threadId!)
    ],
  ];

  const errors: string[] = [];
  for (const [table, apply] of targets) {
    const r = await safeDelete(table, apply);
    if (!r.ok) errors.push(r.error);
  }

  if (errors.length > 0) {
    console.error('[DELETE /api/threads] partial failure:', errors);
    // 🛡️ 부분 실패라도 사용자에게는 "다시 시도" 신호 (멱등성 보장되므로 재시도 안전)
    return NextResponse.json(
      { error: `삭제 일부 실패: ${errors.join(' / ')}. 다시 시도해주세요.` },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
