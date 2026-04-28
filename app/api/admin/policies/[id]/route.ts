import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkAdmin } from '@/app/api/admin/_lib/checkAdmin';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!, 
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 비활성화 (soft delete)
// 🌟 Next.js 15+ 문법: params를 Promise로 감쌉니다.
export async function DELETE(
  req: Request, 
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  
  // 🌟 비동기로 파라미터를 꺼냅니다.
  const { id } = await params;

  const { error } = await supabase
    .from('policies')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id); // 🌟 params.id 대신 추출한 id 사용
    
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// 수정
// 🌟 Next.js 15+ 문법: params를 Promise로 감쌉니다.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  
  // 🌟 비동기로 파라미터를 꺼냅니다.
  const { id } = await params;
  
  const body = await req.json();
  // 안전한 필드만 화이트리스트
  const allowed = ['title', 'provider', 'target_audience', 'age_req', 
                   'income_req', 'region_req', 'summary', 'url', 'deadline'];
  const update: any = { updated_at: new Date().toISOString() };
  for (const k of allowed) {
    if (k in body) update[k] = body[k];
  }
  
  const { error } = await supabase
    .from('policies')
    .update(update)
    .eq('id', id); // 🌟 params.id 대신 추출한 id 사용
    
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
