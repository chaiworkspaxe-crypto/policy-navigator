// lib/rateLimit.ts
import { getSupabase } from '@/lib/supabase';

const supabase = getSupabase();

const MINUTE_LIMIT = Number(process.env.RATE_LIMIT_MINUTE ?? 6);
const DAY_LIMIT = Number(process.env.RATE_LIMIT_DAY ?? 100);
const FAIL_CLOSED = process.env.RATE_LIMIT_FAIL_CLOSED === 'true';

export type RateCheckResult =
  | { allowed: true }
  | { allowed: false; reason: 'minute' | 'day'; current: number; limit: number };

type RpcRateRow = {
  allowed: boolean;
  current_count: number;
};

function readRpcRow(data: unknown): RpcRateRow | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;

  const allowed = (row as any).allowed;
  const current = (row as any).current_count;

  if (typeof allowed !== 'boolean') return null;

  return {
    allowed,
    current_count: Number.isFinite(Number(current)) ? Number(current) : 0,
  };
}

async function incrementBucket(args: {
  userId: string;
  bucket: 'minute' | 'day';
  windowStart: string;
  max: number;
}): Promise<RpcRateRow> {
  const { data, error } = await supabase.rpc('increment_rate_limit', {
    p_user_id: args.userId,
    p_bucket: args.bucket,
    p_window_start: args.windowStart,
    p_max: args.max,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = readRpcRow(data);
  if (!row) {
    throw new Error('invalid rate limit rpc response');
  }

  return row;
}

export async function checkRateLimit(userId: string): Promise<RateCheckResult> {
  if (!userId) return { allowed: true };

  const now = new Date();
  const minuteStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  try {
    const minute = await incrementBucket({
      userId,
      bucket: 'minute',
      windowStart: minuteStart,
      max: MINUTE_LIMIT,
    });

    if (!minute.allowed) {
      return {
        allowed: false,
        reason: 'minute',
        current: minute.current_count,
        limit: MINUTE_LIMIT,
      };
    }

    const day = await incrementBucket({
      userId,
      bucket: 'day',
      windowStart: dayStart,
      max: DAY_LIMIT,
    });

    if (!day.allowed) {
      return {
        allowed: false,
        reason: 'day',
        current: day.current_count,
        limit: DAY_LIMIT,
      };
    }

    return { allowed: true };
  } catch (e) {
    console.error('[rateLimit]', e);

    if (FAIL_CLOSED) {
      return {
        allowed: false,
        reason: 'minute',
        current: MINUTE_LIMIT,
        limit: MINUTE_LIMIT,
      };
    }

    return { allowed: true };
  }
}
