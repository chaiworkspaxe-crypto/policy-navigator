import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const threadId = searchParams.get('thread_id');
  const { data } = await supabase.from('chat_thread_inputs').select('*').eq('thread_id', threadId).single();
  return NextResponse.json({ inputs: data || null });
}

export async function POST(req: Request) {
  const { thread_id, user_id, ...inputs } = await req.json();
  
  // 🌟 DB 트리거가 updated_at을 자동으로 처리하므로 애플리케이션 단에서는 생략합니다.
  const { error } = await supabase.from('chat_thread_inputs').upsert({
    thread_id,
    user_id,
    ...inputs,
  }, { onConflict: 'thread_id' });
  
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
