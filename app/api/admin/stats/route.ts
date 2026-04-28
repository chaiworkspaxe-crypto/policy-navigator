// app/api/admin/stats/route.ts — 전체 교체
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkAdmin } from '@/app/api/admin/_lib/checkAdmin';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!, 
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: Request) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const todayKST = new Date().toLocaleDateString('ko-KR', { 
      timeZone: 'Asia/Seoul',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).replace(/\./g, '-').replace(/ /g, '').replace(/-$/, '');

    // 병렬 쿼리 (Promise.all로 동시 실행 — 응답 속도 ↑)
    const [
      { data: distinctUsers },
      { count: threadCount },
      { data: blockedToday },
      { data: avgDepth },
      { data: regionRanking },
      { data: ageDistribution },
      { data: timeTraffic },
    ] = await Promise.all([
      supabase.rpc('admin_distinct_users'),
      supabase.from('chat_threads').select('*', { count: 'exact', head: true }),
      supabase.rpc('admin_blocked_today', { p_limit: 4 }),
      supabase.rpc('admin_avg_depth'),
      supabase.rpc('admin_region_ranking'),
      supabase.rpc('admin_age_distribution'),
      supabase.rpc('admin_time_traffic'),
    ]);

    return NextResponse.json({
      ok: true,
      data: {
        total_users: Number(distinctUsers) || 0,
        total_threads: threadCount || 0,
        blocked_today: Number(blockedToday) || 0,
        today_date: todayKST,
        avg_conversation_depth: Number(avgDepth) || 0,
        region_ranking: regionRanking || [],
        age_distribution: ageDistribution || [],
        time_traffic: timeTraffic || [],
        top_keywords: [],   // Phase 2에서 user_message 분석으로 추가 예정
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
