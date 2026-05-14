// lib/rateLimit.ts
import { getSupabase } from '@/lib/supabase';

const supabase = getSupabase();

const MINUTE_LIMIT = 6;
const DAY_LIMIT = 100;

export type RateCheckResult =
  | { allowed: true }
  | { allowed: false; reason: 'minute' | 'day'; current: number; limit: number };

export async function checkRateLimit(userId: string): Promise<RateCheckResult> {
  if (!userId) return { allowed: true }; // 익명은 일단 통과 (별도 IP rate limit은 향후)

  const now = new Date();
  const minuteStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  try {
    // 🌟 분 단위 먼저 체크
    const { data: minRes } = await supabase.rpc('increment_rate_limit', {
      p_user_id: userId,
      p_bucket: 'minute',
      p_window_start: minuteStart,
      p_max: MINUTE_LIMIT,
    });
    
    const minRow = Array.isArray(minRes) ? minRes[0] : minRes;
    if (minRow && !minRow.allowed) {
      return { allowed: false, reason: 'minute', current: minRow.current_count, limit: MINUTE_LIMIT };
    }

    // 🌟 일 단위 체크
    const { data: dayRes } = await supabase.rpc('increment_rate_limit', {
      p_user_id: userId,
      p_bucket: 'day',
      p_window_start: dayStart,
      p_max: DAY_LIMIT,
    });
    
    const dayRow = Array.isArray(dayRes) ? dayRes[0] : dayRes;
    if (dayRow && !dayRow.allowed) {
      return { allowed: false, reason: 'day', current: dayRow.current_count, limit: DAY_LIMIT };
    }

    return { allowed: true };
  } catch (e) {
    // 🛡️ rate limit 체크 실패 시 통과시킴 (서비스 차단 방지)
    console.error('[rateLimit]', e);
    return { allowed: true };
  }
}
