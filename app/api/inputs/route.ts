// app/api/inputs/route.ts

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabase } from '@/lib/supabase'; // 🌟 [일관성 유지] 싱글톤 클라이언트 임포트

// 🌟 createClient 직접 호출 제거 및 싱글톤 사용
const supabase = getSupabase();

// 🌟 [개선] 입력값 검증을 위한 Zod 스키마 정의
const InputsSchema = z.object({
  selected_city: z.string().max(50).optional(),
  selected_district: z.string().max(50).optional(),
  selected_dong: z.string().max(50).optional(),
  birth_year: z.string().regex(/^\d{4}$/, "출생연도는 4자리 숫자여야 합니다.").optional(),
  extra_info: z.string().max(500, "추가 정보는 500자 이내여야 합니다.").optional(),
  children_count: z.number().int().min(0).max(10).optional(),  // 🌟 가구 단위 탐색
  has_spouse: z.boolean().optional(),                           // 🌟 가구 단위 탐색
  search_mode: z.enum(['public', 'private']).optional(), // 🌟 신규: 모드 영속성 추가
});

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
    .maybeSingle(); 

  if (error) {
    console.error('[GET /api/inputs]', error);
    return NextResponse.json({ inputs: null }); 
  }
  return NextResponse.json({ inputs: data });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_ID_RE = /^user_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function compactUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { thread_id, user_id, ...rawInputs } = body;

    if (
      typeof thread_id !== 'string' ||
      typeof user_id !== 'string' ||
      !UUID_RE.test(thread_id) ||
      !USER_ID_RE.test(user_id)
    ) {
      return NextResponse.json({ error: 'invalid id format' }, { status: 400 });
    }

    const parsed = InputsSchema.safeParse(rawInputs);
    if (!parsed.success) {
      return NextResponse.json({
        error: 'invalid inputs',
        details: parsed.error.flatten(),
      }, { status: 400 });
    }

    const { data: existingThread, error: ownErr } = await supabase
      .from('chat_threads')
      .select('thread_id, user_id')
      .eq('thread_id', thread_id)
      .maybeSingle();

    if (ownErr) {
      console.error('[POST /api/inputs] ownership check:', ownErr);
      return NextResponse.json({ error: ownErr.message }, { status: 500 });
    }

    if (!existingThread) {
      return NextResponse.json({ error: 'thread not found' }, { status: 404 });
    }

    if (existingThread.user_id !== user_id) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const safeInputs = compactUndefined(parsed.data);

    const { error } = await supabase.from('chat_thread_inputs').upsert(
      {
        thread_id,
        user_id,
        ...safeInputs,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'thread_id,user_id' },
    );

    if (error) {
      console.error('[POST /api/inputs]', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[POST /api/inputs] Unexpected Error:', e);
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
}
