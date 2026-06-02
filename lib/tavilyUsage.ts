// lib/tavilyUsage.ts
import { getSupabase } from '@/lib/supabase';

const supabase = getSupabase();

export type TavilyUsageReservation =
  | {
      allowed: true;
      used: number;
      remaining: number;
      limit: number;
      nearLimit: boolean;
      reason?: string;
    }
  | {
      allowed: false;
      used: number;
      remaining: number;
      limit: number;
      nearLimit: boolean;
      reason: string;
    };

function getKstPeriodYm(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);

  const year = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const month = parts.find((p) => p.type === 'month')?.value ?? '00';

  return `${year}-${month}`;
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const QUOTA_ENABLED = process.env.TAVILY_QUOTA_ENABLED === 'true';
const HARD_LIMIT = readPositiveInt(process.env.TAVILY_MONTHLY_HARD_LIMIT, 950);
const SOFT_LIMIT = readPositiveInt(process.env.TAVILY_MONTHLY_SOFT_LIMIT, 800);
const FAIL_CLOSED = process.env.TAVILY_QUOTA_FAIL_CLOSED === 'true';

type RpcReserveRow = {
  allowed: boolean;
  used_count: number;
  remaining: number;
};

function parseRpcReserveRow(data: unknown): RpcReserveRow | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;

  const allowed = (row as any).allowed;
  const usedCount = Number((row as any).used_count);
  const remaining = Number((row as any).remaining);

  if (typeof allowed !== 'boolean') return null;
  if (!Number.isFinite(usedCount)) return null;
  if (!Number.isFinite(remaining)) return null;

  return {
    allowed,
    used_count: usedCount,
    remaining,
  };
}

/**
 * Tavily 실제 API 호출 직전에 월간 사용량 1회를 원자적으로 예약합니다.
 *
 * - Vercel Edge 여러 인스턴스가 동시에 실행되어도 Supabase RPC의 row lock으로 hard limit 초과를 막습니다.
 * - 캐시 hit에는 이 함수를 호출하지 마세요. 실제 Tavily credit이 소모되지 않기 때문입니다.
 * - SQL migration 적용 전에는 TAVILY_QUOTA_ENABLED=false로 두면 기존 동작과 100% 호환됩니다.
 */
export async function reserveTavilyUsage(cost = 1): Promise<TavilyUsageReservation> {
  if (!QUOTA_ENABLED) {
    return {
      allowed: true,
      used: 0,
      remaining: HARD_LIMIT,
      limit: HARD_LIMIT,
      nearLimit: false,
      reason: 'quota disabled',
    };
  }

  const safeCost = Number.isFinite(cost) && cost > 0 ? Math.floor(cost) : 1;
  const periodYm = getKstPeriodYm();

  try {
    const { data, error } = await supabase.rpc('reserve_tavily_usage', {
      p_period_ym: periodYm,
      p_cost: safeCost,
      p_hard_limit: HARD_LIMIT,
    });

    if (error) throw new Error(error.message);

    const row = parseRpcReserveRow(data);
    if (!row) throw new Error('invalid reserve_tavily_usage response');

    const nearLimit = row.used_count >= SOFT_LIMIT;

    if (!row.allowed) {
      return {
        allowed: false,
        used: row.used_count,
        remaining: row.remaining,
        limit: HARD_LIMIT,
        nearLimit,
        reason: `Tavily 월간 사용량이 한도에 도달했습니다. (${row.used_count}/${HARD_LIMIT})`,
      };
    }

    return {
      allowed: true,
      used: row.used_count,
      remaining: row.remaining,
      limit: HARD_LIMIT,
      nearLimit,
    };
  } catch (e: any) {
    console.error('[tavilyUsage.reserve]', e?.message ?? e);

    if (FAIL_CLOSED) {
      return {
        allowed: false,
        used: 0,
        remaining: 0,
        limit: HARD_LIMIT,
        nearLimit: true,
        reason: 'Tavily 사용량 확인에 실패하여 비용 보호 모드로 차단했습니다',
      };
    }

    return {
      allowed: true,
      used: 0,
      remaining: HARD_LIMIT,
      limit: HARD_LIMIT,
      nearLimit: false,
      reason: 'quota check failed open',
    };
  }
}

/**
 * Tavily API 호출이 타임아웃이나 서버 에러로 실패했을 때,
 * 차감했던 쿼터를 다시 복구(환불)하는 보상 트랜잭션 함수입니다.
 */
export async function refundTavilyUsage(cost = 1): Promise<void> {
  if (!QUOTA_ENABLED) return;
  const safeCost = Number.isFinite(cost) && cost > 0 ? Math.floor(cost) : 1;
  const periodYm = getKstPeriodYm();

  try {
    await supabase.rpc('refund_tavily_usage', {
      p_period_ym: periodYm,
      p_cost: safeCost,
    });
    console.log(`[tavilyUsage.refund] ${safeCost} 쿼터 환불 완료`);
  } catch (e) {
    console.error('[tavilyUsage.refund error]', e);
  }
}
