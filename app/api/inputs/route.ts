// app/api/inputs/route.ts — 전체 교체

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

  if (!threadId || !userId) {
    return NextResponse.json({ inputs: null });
  }

  const { data, error } = await supabase
    .from('chat_thread_inputs')
    .select('*')
    .eq('thread_id', threadId)
    .eq('user_id', userId)
    .maybeSingle(); // 🌟 single() 대신 maybeSingle() — row 없을 때 에러 안 던짐

  if (error) {
    console.error('[GET /api/inputs]', error);
    return NextResponse.json({ inputs: null }); // UX 우선: 폼만 비우고 진행
  }
  return NextResponse.json({ inputs: data });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { thread_id, user_id, ...inputs } = body;
    if (!thread_id || !user_id) {
      return NextResponse.json({ error: 'thread_id, user_id 필요' }, { status: 400 });
    }

    const { error } = await supabase.from('chat_thread_inputs').upsert(
      {
        thread_id,
        user_id,
        ...inputs,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'thread_id' },
    );

    if (error) {
      console.error('[POST /api/inputs]', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
}
