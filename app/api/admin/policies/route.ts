// app/api/admin/policies/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    // 🌟 [Private 폐기 후] 정부 정책(source_type='public' 또는 NULL)만 노출.
    //   - 과거 민간 모드로 저장된 source_type='private' 행은 자동 제외.
    //   - sync 스크립트가 source_type 미설정 시 NULL로 들어가는 행은 정부 정책으로 간주(기존 동작 호환).
    const { data: official, error } = await supabase
      .from('policies')
      .select('*')
      .or('source_type.eq.public,source_type.is.null')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      data: {
        official: official || [],
        agent_collected: [], // 자가 학습 RAG가 폐기됐으므로 영구 빈 배열
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
