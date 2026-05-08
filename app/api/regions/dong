// app/api/regions/dong/route.ts
import { NextResponse } from 'next/server';
// 🌟 여기서만 DONG_MAP을 부릅니다! (서버에서만 돌기 때문에 유저 폰으로 500KB가 다운되지 않음)
import { DONG_MAP } from '@/lib/regionData'; 

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const city = searchParams.get('city');
  const district = searchParams.get('district');

  if (!city || !district) {
    return NextResponse.json({ dongs: [] });
  }

  // 예: "서울특별시-강남구" 키로 조회
  const key = `${city}-${district}`;
  const dongs = DONG_MAP[key as keyof typeof DONG_MAP] || [];

  return NextResponse.json({ dongs }, {
    headers: {
      // 🌟 Vercel CDN에 하루 동안 찰떡같이 캐싱! 두 번째 유저부터는 0.01초 만에 응답함
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=43200'
    }
  });
}
