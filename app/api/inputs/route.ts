import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const threadId = searchParams.get('thread_id');
  const { data } = await supabase.from('thread_inputs').select('*').eq('thread_id', threadId).single();
  return NextResponse.json({ inputs: data || null });
}

export async function POST(req: Request) {
  const { thread_id, user_id, ...inputs } = await req.json();
  
  // Upsert (있으면 덮어쓰기, 없으면 생성)
  const { error } = await supabase.from('thread_inputs').upsert({
    thread_id,
    user_id,
    ...inputs,
  }, { onConflict: 'thread_id' });
  
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
