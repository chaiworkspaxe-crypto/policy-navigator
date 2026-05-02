import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function GET() {
  try {
    // 1. 전체 유저 수 (중복 제거)
    const { count: userCount } = await supabase
      .from('chat_threads')
      .select('user_id', { count: 'exact', head: true });

    // 2. 전체 대화방 수
    const { count: threadCount } = await supabase
      .from('chat_threads')
      .select('*', { count: 'exact', head: true });

    // 3. 전체 메시지 수
    const { count: messageCount } = await supabase
      .from('chat_messages')
      .select('*', { count: 'exact', head: true });

    return NextResponse.json({
      ok: true,
      data: {
        // --- 1. 상단 통계 카드용 실제 데이터 ---
        total_users: userCount || 0,
        total_threads: threadCount || 0,
        blocked_today: 0, // 나중에 실제 차단 로직 생기면 연동
        today_date: new Date().toISOString().split('T')[0],
        // 평균 대화 턴 수 계산 (메시지 수 / 대화방 수)
        avg_conversation_depth: threadCount && messageCount ? Math.round(messageCount / threadCount) : 0,

        // --- 2. 하단 그래프용 더미(Mock) 데이터 (UI 확인용) ---
        region_ranking: [
          { name: "서울", value: 120 },
          { name: "경기", value: 85 },
          { name: "부산", value: 45 },
          { name: "대구", value: 30 },
          { name: "인천", value: 25 }
        ],
        age_distribution: [
          { name: "20대", value: 450 },
          { name: "30대", value: 300 },
          { name: "40대", value: 150 },
          { name: "50대 이상", value: 100 }
        ],
        time_traffic: [
          { hour: "06:00", count: 5 },
          { hour: "09:00", count: 45 },
          { hour: "12:00", count: 80 },
          { hour: "15:00", count: 65 },
          { hour: "18:00", count: 120 },
          { hour: "21:00", count: 95 }
        ],
        top_keywords: [
          { keyword: "월세", count: 150 },
          { keyword: "청년", count: 125 },
          { keyword: "무주택", count: 98 },
          { keyword: "대출", count: 85 },
          { keyword: "취업", count: 60 }
        ]
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
