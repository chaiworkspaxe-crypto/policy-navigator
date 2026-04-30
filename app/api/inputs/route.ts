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
  
  // 🌟 [최종 수술] DB가 원하는 대로 created_at은 빼고, updated_at만 필수로 넣어줍니다!
  const { error } = await supabase.from('chat_thread_inputs').upsert({
    thread_id,
    user_id,
    ...inputs,
    updated_at: new Date().toISOString() // 🚨 딱 이거 하나만 들어갑니다!
  }, { onConflict: 'thread_id' });
  
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
