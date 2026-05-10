// app/admin/dashboard/actions.ts
"use server";

import { createClient } from '@supabase/supabase-js';

export async function getPeriodUserCount(startDate: string, endDate: string) {
  try {
    // 🌟 서버 전용 마스터 키(SERVICE_ROLE_KEY)를 사용하여 RLS 보안을 우회합니다.
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 검색 기간을 해당 일자의 00:00:00 부터 23:59:59 까지로 세팅
    const startIso = `${startDate}T00:00:00.000Z`;
    const endIso = `${endDate}T23:59:59.999Z`;

    const { data, error } = await supabase
      .from('chat_threads')
      .select('user_id')
      .gte('updated_at', startIso)
      .lte('updated_at', endIso);

    if (error) {
      console.error("기간별 유저 조회 DB 에러:", error);
      return 0;
    }

    // 중복되는 user_id 제거 (순수 방문자 수 카운트)
    const uniqueUsers = new Set(data?.map(d => d.user_id)).size;
    return uniqueUsers;
  } catch (e) {
    console.error("getPeriodUserCount 에러:", e);
    return 0;
  }
}
