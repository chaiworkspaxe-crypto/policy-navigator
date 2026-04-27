import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function GET() {
  try {
    // 1. 공식 데이터 (예: policies 테이블)
    const { data: official } = await supabase
      .from('policies')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    return NextResponse.json({
      ok: true,
      data: {
        official: official || [],
        agent_collected: [] // 만약 별도의 수집 테이블이 있다면 여기에 추가
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
