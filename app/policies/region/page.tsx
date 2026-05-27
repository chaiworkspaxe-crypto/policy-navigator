// app/policies/region/page.tsx
// ────────────────────────────────────────────────────────────
// 🌟 지역별 정책 인덱스 페이지
// ────────────────────────────────────────────────────────────
import Link from 'next/link';
import type { Metadata } from 'next';
import { REGION_LIST, getRegionPolicyCounts } from '@/lib/policies';

export const revalidate = 86400;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://policyai.kr';

export const metadata: Metadata = {
  title: '지역별 정책·지원금 모음 | PolicyAI',
  description: '전국 17개 시·도별로 신청 가능한 정부·지자체 정책, 보조금, 혜택을 한눈에 확인하세요.',
  openGraph: { title: '지역별 정책·지원금 모음 | PolicyAI', url: `${SITE_URL}/policies/region` },
  alternates: { canonical: `${SITE_URL}/policies/region` },
};

export default async function RegionIndexPage() {
  const counts = await getRegionPolicyCounts();

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-[#111]">
      <div className="max-w-4xl mx-auto px-4 py-10">
        <nav className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          <Link href="/" className="hover:text-green-600">PolicyAI</Link>
          <span className="mx-1.5">/</span>
          <span className="text-gray-800 dark:text-gray-200">지역별 정책</span>
        </nav>

        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          📍 지역별 정책·지원금 모음
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-8">
          거주 지역을 선택하면 해당 지역에서 신청할 수 있는 정책을 모아볼 수 있습니다.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {REGION_LIST.map((sido) => (
            <Link
              key={sido}
              href={`/policies/region/${encodeURIComponent(sido)}`}
              className="flex flex-col items-center justify-center p-4 bg-white dark:bg-[#1e1e1e] rounded-xl border border-gray-200 dark:border-[#333] hover:border-green-400 dark:hover:border-green-700 hover:shadow-md transition-all text-center"
            >
              <span className="text-sm font-bold text-gray-800 dark:text-gray-100">
                {sido.replace(/특별시|광역시|특별자치시|특별자치도|도$/g, '') || sido}
              </span>
              {counts[sido] !== undefined && (
                <span className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  {counts[sido]}건
                </span>
              )}
            </Link>
          ))}
        </div>

        <div className="mt-10 text-center">
          <Link
            href="/"
            className="inline-block px-6 py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded-xl transition-colors"
          >
            🤖 AI에게 내 맞춤 정책 찾기
          </Link>
        </div>
      </div>
    </main>
  );
}
