// lib/supabase.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!url || !key) {
    // 🛡️ Fail-Fast: 부재 시 즉시 명시적 에러 발생
    throw new Error('Supabase 환경변수가 설정되지 않았습니다. (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
  }
  
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }, // 🌟 Edge 환경 최적화
    global: { 
      headers: { 'x-app': 'policy-navigator' },
    },
  });
  
  return _client;
}
