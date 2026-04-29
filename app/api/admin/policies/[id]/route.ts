import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkAdmin } from '@/app/api/admin/_lib/checkAdmin';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!, 
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 비활성화 (soft delete)
export async function DELETE(
  req: Request, 
  { params }: { params: Promise<{ id: string }> } // 🌟 Next.js 15+ 문법 사수!
) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  
  const { id } = await params; // 🌟 비동기로 꺼내기
  
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }
  
  const { error } = await supabase
    .from('policies')
    .update({ 
      is_active: false, 
      updated_at: new Date().toISOString() 
    })
    .eq('id', id);
    
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// 수정
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> } // 🌟 Next.js 15+ 문법 사수!
) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  
  const { id } = await params; // 🌟 비동기로 꺼내기
  
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }
  
  const body = await req.json();
  
  // 🌟 새 기획안 반영: 안전한 필드만 화이트리스트 (category, is_active 등 확장)
  const ALLOWED_FIELDS = [
    'title', 'provider', 'target_audience', 
    'age_req', 'income_req', 'region_req', 
    'summary', 'url', 'deadline', 'category', 'is_active'
  ];
  
  const update: any = { updated_at: new Date().toISOString() };
  for (const k of ALLOWED_FIELDS) {
    if (k in body) update[k] = body[k];
  }
  
  // 🌟 새 기획안 반영: 업데이트할 알맹이가 없으면 DB 찌르지 않기
  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
  }
  
  const { error } = await supabase
    .from('policies')
    .update(update)
    .eq('id', id);
    
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
