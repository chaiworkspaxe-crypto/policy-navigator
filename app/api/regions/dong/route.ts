// app/api/regions/dong/route.ts
import { DONG_MAP } from '@/lib/regionData';

// 🌟 [최적화] Edge runtime 적용: Node.js 대비 Cold Start가 거의 없어 응답 속도가 압도적임
export const runtime = 'edge';

// 🌟 [최적화] 24시간 동안 정적으로 다시 계산하지 않도록 설정 (변경이 거의 없는 데이터)
export const revalidate = 86400;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const city = searchParams.get('city');
  const district = searchParams.get('district');

  // 입력값 누락 시 빈 배열 즉시 반환
  if (!city || !district) {
    return Response.json({ dongs: [] });
  }

  // 예: "서울특별시-강남구" 키로 조회
  const key = `${city}-${district}`;
  const dongs = DONG_MAP[key as keyof typeof DONG_MAP] || [];

  return Response.json(
    { dongs },
    {
      headers: {
        // 🌟 강력한 3중 캐시 전략
        // 1. s-maxage=86400: Vercel CDN 서버에 24시간 동안 저장
        // 2. stale-while-revalidate=43200: 캐시 만료 후에도 12시간 동안은 일단 옛날 데이터를 주면서 백그라운드에서 조용히 갱신
        // 3. immutable: 이 주소의 데이터는 절대 변하지 않는다는 힌트를 주어 브라우저가 매번 물어보지 않게 함
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=43200, immutable',
        'Vary': 'Accept-Encoding',
      },
    },
  );
}
