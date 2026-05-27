// app/policies/region/[sido]/page.tsx
// ────────────────────────────────────────────────────────────
// 🌟 지역별 정책 랜딩페이지 — SEO 검색 유입용
// ────────────────────────────────────────────────────────────
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getPoliciesByRegion, REGION_LIST, type PolicyCard } from '@/lib/policies';

export const revalidate = 86400; // ISR: 24시간

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://policyai.kr';

// ── 동적 경로 사전 생성 ──
export async function generateStaticParams() {
  return REGION_LIST.map((sido) => ({ sido: encodeURIComponent(sido) }));
}

// ── 메타데이터 ──
export async function generateMetadata({ params }: { params: Promise<{ sido: string }> }): Promise<Metadata> {
  const { sido: rawSido } = await params;
  const sido = decodeURIComponent(rawSido);
  if (!REGION_LIST.includes(sido as any)) return {};

  const title = `${sido} 정책·지원금 모음 | PolicyAI`;
  const description = `${sido} 거주자가 신청할 수 있는 정부·지자체 정책, 보조금, 혜택을 한눈에 확인하세요. AI가 맞춤형으로 찾아드립니다.`;

  return {
    title,
    description,
    openGraph: { title, description, url: `${SITE_URL}/policies/region/${encodeURIComponent(sido)}` },
    alternates: { canonical: `${SITE_URL}/policies/region/${encodeURIComponent(sido)}` },
  };
}

// ── 마감일 포맷 ──
function formatDeadline(d: string | null): string {
  if (!d) return '상시모집';
  const days = Math.ceil((Date.parse(d) - Date.now()) / (24 * 3600_000));
  if (days < 0) return '마감됨';
  if (days === 0) return '오늘 마감!';
  if (days <= 7) return `D-${days} 🔥`;
  const dt = new Date(d);
  return `~${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')}`;
}

// ── 페이지 본문 ──
export default async function RegionPoliciesPage({ params }: { params: Promise<{ sido: string }> }) {
  const { sido: rawSido } = await params;
  const sido = decodeURIComponent(rawSido);

  if (!REGION_LIST.includes(sido as any)) notFound();

  const policies = await getPoliciesByRegion(sido, 200);

  // JSON-LD BreadcrumbList
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'PolicyAI', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: '지역별 정책', item: `${SITE_URL}/policies/region` },
      { '@type': 'ListItem', position: 3, name: `${sido} 정책`, item: `${SITE_URL}/policies/region/${encodeURIComponent(sido)}` },
    ],
  };

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-[#111]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />

      {/* 헤더 */}
      <div className="bg-white dark:bg-[#1a1a1a] border-b border-gray-200 dark:border-[#333]">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <nav className="text-sm text-gray-500 dark:text-gray-400 mb-3">
            <Link href="/" className="hover:text-green-600">PolicyAI</Link>
            <span className="mx-1.5">/</span>
            <Link href="/policies/region" className="hover:text-green-600">지역별 정책</Link>
            <span className="mx-1.5">/</span>
            <span className="text-gray-800 dark:text-gray-200">{sido}</span>
          </nav>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            📍 {sido} 정책·지원금 모음
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            {sido} 거주자가 신청할 수 있는 정부·지자체 정책 {policies.length}건을 확인하세요.
          </p>
          <Link
            href="/"
            className="inline-block mt-4 px-5 py-2.5 bg-green-600 hover:bg-green-500 text-white font-bold rounded-xl transition-colors text-sm"
          >
            🤖 AI에게 내 맞춤 정책 찾기
          </Link>
        </div>
      </div>

      {/* 정책 목록 */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        {policies.length === 0 ? (
          <p className="text-center text-gray-500 dark:text-gray-400 py-12">
            {sido} 지역 정책이 아직 등록되지 않았습니다.
          </p>
        ) : (
          <div className="grid gap-3">
            {policies.map((p) => (
              <article
                key={p.slug}
                className="bg-white dark:bg-[#1e1e1e] rounded-xl border border-gray-200 dark:border-[#333] p-4 hover:border-green-400 dark:hover:border-green-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/policy/${encodeURIComponent(p.slug)}`}
                      className="text-sm font-bold text-gray-900 dark:text-white hover:text-green-600 dark:hover:text-green-400 transition-colors line-clamp-1"
                    >
                      {p.title}
                    </Link>
                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 dark:text-gray-400">
                      <span>{p.provider}</span>
                      {p.category && (
                        <>
                          <span className="text-gray-300 dark:text-gray-600">·</span>
                          <span>{p.category}</span>
                        </>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
                      {p.summary}
                    </p>
                  </div>
                  <span className={`shrink-0 text-xs font-bold px-2 py-1 rounded-lg ${
                    formatDeadline(p.deadline).includes('마감됨')
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-400'
                      : formatDeadline(p.deadline).includes('🔥')
                      ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                      : 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                  }`}>
                    {formatDeadline(p.deadline)}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
