import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// 🌟 [최종 해결 설정] Next.js가 이 API 결과를 캐싱하지 않도록 강제합니다.
export const dynamic = 'force-dynamic'; 

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!, 
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const threadId = searchParams.get('thread_id');
  const userId = searchParams.get('user_id');
  
  if (!threadId || !userId) {
    return NextResponse.json({ error: 'thread_id and user_id required' }, { status: 400 });
  }
  
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('thread_id', threadId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
    
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  
  // 🌟 캐시를 방지하는 헤더를 더 강력하게 추가
  return new NextResponse(JSON.stringify({ messages: data }), {
    status: 200,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
