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
    const { thread_id, user_id, ...rawInputs } = body;
    
    if (!thread_id || !user_id || typeof thread_id !== 'string' || typeof user_id !== 'string') {
      return NextResponse.json({ error: 'thread_id, user_id 필요' }, { status: 400 });
    }

    // 🛡️ [개선 1] 화이트리스트로 inputs 필드 제한 — 임의 컬럼 주입 차단
    const allowedFields = [
      'selected_city',
      'selected_district',
      'selected_dong',
      'birth_year',
      'extra_info',
    ] as const;
    
    const safeInputs: Record<string, unknown> = {};
    for (const k of allowedFields) {
      if (rawInputs[k] !== undefined) {
        // 길이 제한 방어막 추가
        const v = rawInputs[k];
        safeInputs[k] = typeof v === 'string' ? v.slice(0, 500) : v;
      }
    }

    // 🛡️ [개선 2] 소유권 사전 검증 — 다른 사용자의 thread를 덮어쓰는 IDOR 차단
    const { data: existingThread, error: ownErr } = await supabase
      .from('chat_threads')
      .select('user_id')
      .eq('thread_id', thread_id)
      .maybeSingle();

    if (ownErr) {
      console.error('[POST /api/inputs] ownership check:', ownErr);
      return NextResponse.json({ error: ownErr.message }, { status: 500 });
    }
    
    // thread가 없으면(새로 만든 직후 race일 수 있음) 통과 — upsert가 처리
    // thread가 있는데 user_id가 다르면 차단 (IDOR 공격 방어)
    if (existingThread && existingThread.user_id !== user_id) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const { error } = await supabase.from('chat_thread_inputs').upsert(
      {
        thread_id,
        user_id,
        ...safeInputs,
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
}// app/api/inputs/route.ts — 전체 교체

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
    const { thread_id, user_id, ...rawInputs } = body;
    
    if (!thread_id || !user_id || typeof thread_id !== 'string' || typeof user_id !== 'string') {
      return NextResponse.json({ error: 'thread_id, user_id 필요' }, { status: 400 });
    }

    // 🛡️ [개선 1] 화이트리스트로 inputs 필드 제한 — 임의 컬럼 주입 차단
    const allowedFields = [
      'selected_city',
      'selected_district',
      'selected_dong',
      'birth_year',
      'extra_info',
    ] as const;
    
    const safeInputs: Record<string, unknown> = {};
    for (const k of allowedFields) {
      if (rawInputs[k] !== undefined) {
        // 길이 제한 방어막 추가
        const v = rawInputs[k];
        safeInputs[k] = typeof v === 'string' ? v.slice(0, 500) : v;
      }
    }

    // 🛡️ [개선 2] 소유권 사전 검증 — 다른 사용자의 thread를 덮어쓰는 IDOR 차단
    const { data: existingThread, error: ownErr } = await supabase
      .from('chat_threads')
      .select('user_id')
      .eq('thread_id', thread_id)
      .maybeSingle();

    if (ownErr) {
      console.error('[POST /api/inputs] ownership check:', ownErr);
      return NextResponse.json({ error: ownErr.message }, { status: 500 });
    }
    
    // thread가 없으면(새로 만든 직후 race일 수 있음) 통과 — upsert가 처리
    // thread가 있는데 user_id가 다르면 차단 (IDOR 공격 방어)
    if (existingThread && existingThread.user_id !== user_id) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const { error } = await supabase.from('chat_thread_inputs').upsert(
      {
        thread_id,
        user_id,
        ...safeInputs,
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
