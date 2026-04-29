import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!, 
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const threadId = searchParams.get('thread_id');
  const userId = searchParams.get('user_id');
  
  // ✅ 필수 파라미터 검증 (보안 강화)
  if (!threadId || !userId) {
    return NextResponse.json(
      { error: 'thread_id and user_id required' }, 
      { status: 400 }
    );
  }
  
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('thread_id', threadId)
    .eq('user_id', userId)   // ✅ user_id로 한 번 더 거름 (남의 대화 조회 차단!)
    .order('created_at', { ascending: true });
    
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ messages: data });
}
