import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('user_id');
  
  const { data, error } = await supabase.from('chat_threads').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ threads: data });
}

export async function POST(req: Request) {
  const { user_id } = await req.json();
  const thread_id = uuidv4();
  const { error } = await supabase.from('chat_threads').insert({ thread_id, user_id, title: '새 대화' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ thread_id });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('user_id');
  const threadId = searchParams.get('thread_id');
  const deleteAll = searchParams.get('delete_all');

  if (deleteAll === 'true') {
    await supabase.from('chat_threads').delete().eq('user_id', userId);
  } else if (threadId) {
    await supabase.from('chat_threads').delete().eq('user_id', userId).eq('thread_id', threadId);
  }
  return NextResponse.json({ success: true });
}
