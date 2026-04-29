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
    // KST 기준 오늘 날짜 문자열
    const todayKST = new Date().toLocaleDateString('ko-KR', { 
      timeZone: 'Asia/Seoul',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).replace(/\. /g, '-').replace(/\.$/, '');

    // 병렬 쿼리 (성능 ↑)
    const [
      distinctUsersResult,
      threadCountResult,
      blockedTodayResult,
      avgDepthResult,
      regionRankingResult,
      ageDistributionResult,
      timeTrafficResult,
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
        total_users: Number(distinctUsersResult.data) || 0,
        total_threads: threadCountResult.count || 0,
        blocked_today: Number(blockedTodayResult.data) || 0,
        today_date: todayKST,
        avg_conversation_depth: Number(avgDepthResult.data) || 0,
        region_ranking: regionRankingResult.data || [],
        age_distribution: ageDistributionResult.data || [],
        time_traffic: timeTrafficResult.data || [],
        top_keywords: [],   // 추후 user message 분석으로 채울 예정
      }
    });
  } catch (error: any) {
    console.error('admin stats error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
