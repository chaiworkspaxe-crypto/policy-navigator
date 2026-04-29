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
  
  // 🌟 현재 시간을 명시적으로 생성해서 넣어줍니다!
  const now = new Date().toISOString();
  
  const { error } = await supabase.from('chat_thread_inputs').upsert({
    thread_id,
    user_id,
    ...inputs,
    updated_at: now, // ✅ 에러의 주범이었던 updated_at 강제 주입!
  }, { onConflict: 'thread_id' });
  
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
