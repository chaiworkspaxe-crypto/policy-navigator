// app/api/admin/active-users/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'edge';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    // 🌟 1단계에서 Supabase SQL Editor에 만들었던 함수(RPC)를 여기서 호출!
    const { data, error } = await supabase.rpc('get_active_user_stats');

    if (error) {
      console.error('[active-users API] Supabase RPC 에러:', error);
      return NextResponse.json({ today: 0, week: 0, month: 0 }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('[active-users API] 서버 에러:', error);
    return NextResponse.json({ today: 0, week: 0, month: 0 }, { status: 500 });
  }
}
