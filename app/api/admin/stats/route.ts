// app/api/admin/stats/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// 🌟 [중요] Next.js 캐싱 절대 금지 및 실시간 DB 조회 강제
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!, 
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    // 1. 실제 데이터(채팅방 및 메시지 수) 병렬 조회
    const [threadsResult, messagesCountResult] = await Promise.all([
      supabase.from('chat_threads').select('user_id, updated_at'),
      supabase.from('chat_messages').select('*', { count: 'exact', head: true })
    ]);

    if (threadsResult.error) throw threadsResult.error;
    const threads = threadsResult.data || [];
    const totalMessages = messagesCountResult.count || 0;

    // 2. 시간 기준 설정 (KST 한국 시간 기준)
    const now = new Date();
    // UTC와 KST의 9시간 차이를 보정하여 오늘 자정(00:00:00)Ms 구하기
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstNow = new Date(now.getTime() + kstOffset);
    
    const startOfTodayKst = new Date(kstNow);
    startOfTodayKst.setUTCHours(0, 0, 0, 0);
    const todayMs = startOfTodayKst.getTime() - kstOffset; // DB 비교용 UTC 기준 시간

    const startOfWeekMs = now.getTime() - (7 * 24 * 60 * 60 * 1000);
    const startOfMonthMs = now.getTime() - (30 * 24 * 60 * 60 * 1000);

    // 3. 고유 유저 집계를 위한 Set 준비
    const totalUsersSet = new Set();
    const dauSet = new Set();
    const wauSet = new Set();
    const mauSet = new Set();

    // 4. 데이터 순회 및 집계
    threads.forEach(thread => {
      const updatedTime = new Date(thread.updated_at).getTime();
      const userId = thread.user_id;

      totalUsersSet.add(userId);
      if (updatedTime >= todayMs) dauSet.add(userId);
      if (updatedTime >= startOfWeekMs) wauSet.add(userId);
      if (updatedTime >= startOfMonthMs) mauSet.add(userId);
    });

    const totalThreads = threads.length;

    // 5. 최종 데이터 구성 (기존 대시보드 UI 호환)
    return NextResponse.json({
      ok: true,
      data: {
        // --- 상단 카드용 실시간 데이터 ---
        total_users: totalUsersSet.size,
        total_threads: totalThreads,
        dau: dauSet.size, // 오늘 접속 유저
        wau: wauSet.size, // 이번 주 유저
        mau: mauSet.size, // 한 달 유저
        avg_conversation_depth: totalThreads > 0 ? Math.round(totalMessages / totalThreads) : 0,
        blocked_today: 0,
        today_date: now.toISOString().split('T')[0],

        // --- 하단 그래프용 데이터 (필요 시 이 부분도 별도 테이블 쿼리로 대체 가능) ---
        region_ranking: [
          { name: "서울", value: 120 },
          { name: "경기", value: 85 },
          { name: "부산", value: 45 },
          { name: "대구", value: 30 },
          { name: "인천", value: 25 }
        ],
        age_distribution: [
          { name: "20대", value: 45 },
          { name: "30대", value: 30 },
          { name: "40대", value: 15 },
          { name: "50대 이상", value: 10 }
        ],
        top_keywords: [
          { keyword: "월세", count: 150 },
          { keyword: "청년", count: 125 },
          { keyword: "무주택", count: 98 },
          { keyword: "대출", count: 85 }
        ]
      }
    });
  } catch (error: any) {
    console.error('Stats API Error:', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
