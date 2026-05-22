// app/policy/[slug]/page.tsx
// ────────────────────────────────────────────────────────────
// 🌟 SEO 정책 상세 페이지 — ISR + Server Component
// /policy/청년-월세-한시-특별지원 같은 URL로 접근
// ────────────────────────────────────────────────────────────
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import {
  getPolicyBySlug,
  getRelatedPolicies,
  getDeadlineStatus,
  type PolicyDetail,
  type PolicyCard,
} from '@/lib/policies';

// ── ISR 설정 ────────────────────────────────────────────────
// sync_db.yml 크론이 매일 KST 04:00 실행이므로 24시간 캐시
export const revalidate = 86400;

// 빌드 시점에 전체를 생성하지 않음 (Vercel 무료 빌드 타임아웃 방지)
// 첫 요청 시 동적 생성 후 캐시
export const dynamicParams = true;

// ── 동적 메타데이터 (SEO 핵심) ──────────────────────────────
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://policyai.kr';

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const policy = await getPolicyBySlug(decodeURIComponent(slug));

  if (!policy) {
    return { title: '정책을 찾을 수 없습니다 | 정책 내비게이터' };
  }

  const { isExpired } = getDeadlineStatus(policy.deadline);
  const title = `${policy.title} | ${policy.provider} | 정책 내비게이터`;
  const description = policy.summary.length > 155
    ? policy.summary.slice(0, 152) + '...'
    : policy.summary;

  return {
    title,
    description,
    openGraph: {
      title: policy.title,
      description,
      url: `${SITE_URL}/policy/${encodeURIComponent(policy.slug)}`,
      siteName: '정책 내비게이터',
      locale: 'ko_KR',
      type: 'article',
    },
    twitter: {
      card: 'summary',
      title: policy.title,
      description,
    },
    alternates: {
      canonical: `${SITE_URL}/policy/${encodeURIComponent(policy.slug)}`,
    },
    // 🛡️ 마감된 정책은 검색엔진에서 제외
    ...(isExpired ? { robots: { index: false, follow: true } } : {}),
  };
}

// ── JSON-LD 구조화 데이터 (Google 리치 스니펫) ──────────────
function PolicyJsonLd({ policy }: { policy: PolicyDetail }) {
  const { isExpired, label } = getDeadlineStatus(policy.deadline);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'GovernmentService',
    name: policy.title,
    provider: {
      '@type': 'GovernmentOrganization',
      name: policy.provider,
    },
    description: policy.summary,
    url: policy.url || `${SITE_URL}/policy/${encodeURIComponent(policy.slug)}`,
    areaServed: {
      '@type': 'AdministrativeArea',
      name: [policy.region_sido, policy.region_sigungu].filter(Boolean).join(' ') || '대한민국',
    },
    ...(policy.deadline && !isExpired
      ? { availableThrough: policy.deadline }
      : {}),
    serviceType: policy.category || '정부지원',
    isAccessibleForFree: true,
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

// ── 메인 페이지 컴포넌트 (Server Component) ─────────────────
export default async function PolicyPage({ params }: PageProps) {
  const { slug } = await params;
  const policy = await getPolicyBySlug(decodeURIComponent(slug));

  if (!policy) notFound();

  const deadline = getDeadlineStatus(policy.deadline);
  const relatedPolicies = await getRelatedPolicies(policy, 6);
  const lastChecked = policy.last_seen_at
    ? new Date(policy.last_seen_at).toLocaleDateString('ko-KR')
    : null;

  // 연령 대상 텍스트
  const ageText = policy.age_min != null && policy.age_max != null
    ? `만 ${policy.age_min}세 ~ ${policy.age_max}세`
    : policy.age_min != null
      ? `만 ${policy.age_min}세 이상`
      : policy.age_max != null
        ? `만 ${policy.age_max}세 이하`
        : null;

  // 지역 텍스트
  const regionText = [policy.region_sido, policy.region_sigungu].filter(Boolean).join(' ') || null;

  // 가구 유형
  const householdText = policy.household_types && policy.household_types.length > 0
    ? policy.household_types.join(', ')
    : null;

  return (
    <>
      <PolicyJsonLd policy={policy} />

      <div className="min-h-screen bg-gray-50 dark:bg-[#0e0e0e] text-gray-900 dark:text-gray-100">

        {/* ── 헤더 내비게이션 ────────────────────────────── */}
        <header className="sticky top-0 z-30 bg-white/80 dark:bg-[#121212]/80 backdrop-blur-md border-b border-gray-200 dark:border-[#333]">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 text-green-600 hover:text-green-500 transition-colors font-bold text-sm">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              정책 내비게이터
            </Link>
            {lastChecked && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                마지막 확인: {lastChecked}
              </span>
            )}
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-4 py-8">

          {/* ── 브레드크럼 (SEO + 사용자 내비게이션) ────── */}
          <nav aria-label="breadcrumb" className="mb-6 text-sm text-gray-500 dark:text-gray-400">
            <ol className="flex flex-wrap items-center gap-1">
              <li><Link href="/" className="hover:text-green-600 transition-colors">홈</Link></li>
              <li className="mx-1">/</li>
              {policy.category && (
                <>
                  <li><span className="text-gray-400">{policy.category}</span></li>
                  <li className="mx-1">/</li>
                </>
              )}
              <li className="text-gray-700 dark:text-gray-200 font-medium truncate max-w-[200px]">
                {policy.title}
              </li>
            </ol>
          </nav>

          {/* ── 마감 상태 배너 ───────────────────────────── */}
          {deadline.isExpired && (
            <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-400 text-sm font-bold flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              이 정책의 신청 기간이 마감되었습니다. 유사한 혜택을 찾으시려면 아래 버튼을 눌러보세요.
            </div>
          )}

          {deadline.urgency === 'urgent' && !deadline.isExpired && (
            <div className="mb-6 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 text-amber-700 dark:text-amber-400 text-sm font-bold flex items-center gap-2">
              🔥 마감 임박! {deadline.label} — 서두르세요!
            </div>
          )}

          {/* ── 정책 카드 (메인 콘텐츠) ──────────────────── */}
          <article className="bg-white dark:bg-[#1a1a1a] rounded-2xl border border-gray-200 dark:border-[#333] shadow-sm overflow-hidden">

            {/* 제목 영역 */}
            <div className="p-6 sm:p-8 border-b border-gray-100 dark:border-[#2a2a2a]">
              <div className="flex items-start justify-between gap-4 mb-3">
                <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white leading-tight">
                  {policy.title}
                </h1>
                <span className={`shrink-0 px-3 py-1 rounded-full text-xs font-bold ${
                  deadline.isExpired
                    ? 'bg-gray-100 dark:bg-gray-800 text-gray-500'
                    : deadline.urgency === 'urgent'
                      ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                      : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                }`}>
                  {deadline.label}
                </span>
              </div>

              <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
                🏢 {policy.provider}
                {policy.category && <span className="ml-3">📂 {policy.category}</span>}
              </p>
            </div>

            {/* 요약 */}
            <div className="p-6 sm:p-8">
              <h2 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                📋 정책 요약
              </h2>
              <p className="text-base leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {policy.summary}
              </p>
            </div>

            {/* 상세 정보 그리드 */}
            <div className="px-6 sm:px-8 pb-6 sm:pb-8">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

                {ageText && (
                  <InfoChip icon="🎂" label="대상 연령" value={ageText} />
                )}

                {regionText && (
                  <InfoChip icon="📍" label="대상 지역" value={regionText} />
                )}

                {householdText && (
                  <InfoChip icon="👨‍👩‍👧" label="가구 유형" value={householdText} />
                )}

                <InfoChip
                  icon="⏰"
                  label="신청 기간"
                  value={deadline.label}
                  highlight={deadline.urgency === 'urgent'}
                />
              </div>
            </div>

            {/* 공식 링크 */}
            {policy.url && (
              <div className="px-6 sm:px-8 pb-6 sm:pb-8">
                <a
                  href={policy.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-colors text-sm shadow-sm"
                >
                  🔗 공식 사이트에서 자세히 보기
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>
              </div>
            )}
          </article>

          {/* ── CTA: 채팅으로 더 찾기 (핵심 전환 유도) ───── */}
          <div className="mt-8 p-6 sm:p-8 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-2xl border border-green-200 dark:border-green-800/40 text-center">
            <h2 className="text-lg sm:text-xl font-extrabold text-gray-900 dark:text-white mb-2">
              🎯 나에게 맞는 혜택, 더 있을까?
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
              거주지와 나이만 입력하면, AI가 받을 수 있는 <strong>모든 정부 혜택</strong>을 찾아드려요.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-8 py-3.5 bg-green-600 hover:bg-green-500 text-white font-bold rounded-full transition-all shadow-lg hover:shadow-xl text-base"
            >
              🔍 내 맞춤 혜택 무료로 찾기
            </Link>
            <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
              로그인 없이 바로 이용 가능 · 전국 14,000+ 정책 실시간 탐색
            </p>
          </div>

          {/* ── 관련 정책 (내부 링크 = SEO 시너지) ───────── */}
          {relatedPolicies.length > 0 && (
            <section className="mt-10">
              <h2 className="text-lg font-extrabold text-gray-900 dark:text-white mb-4">
                📌 비슷한 혜택도 확인해보세요
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {relatedPolicies.map((rp) => (
                  <RelatedPolicyCard key={rp.slug} policy={rp} />
                ))}
              </div>
            </section>
          )}

          {/* ── 하단 안내 ─────────────────────────────────── */}
          <footer className="mt-12 pb-8 text-center text-xs text-gray-400 dark:text-gray-500 space-y-1">
            <p>이 페이지는 공공 데이터를 기반으로 자동 생성되었으며, 실제 신청 조건은 공식 사이트에서 반드시 확인해 주세요.</p>
            <p>
              <Link href="/" className="text-green-600 hover:underline">정책 내비게이터 홈으로</Link>
            </p>
          </footer>
        </main>
      </div>
    </>
  );
}

// ── 서브 컴포넌트 ───────────────────────────────────────────
function InfoChip({ icon, label, value, highlight = false }: {
  icon: string;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={`flex items-start gap-3 p-3 rounded-xl border ${
      highlight
        ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/30'
        : 'bg-gray-50 dark:bg-[#222] border-gray-100 dark:border-[#333]'
    }`}>
      <span className="text-lg shrink-0">{icon}</span>
      <div>
        <p className="text-xs font-bold text-gray-400 dark:text-gray-500 mb-0.5">{label}</p>
        <p className={`text-sm font-medium ${
          highlight ? 'text-amber-700 dark:text-amber-400' : 'text-gray-800 dark:text-gray-200'
        }`}>{value}</p>
      </div>
    </div>
  );
}

function RelatedPolicyCard({ policy }: { policy: PolicyCard }) {
  const deadline = getDeadlineStatus(policy.deadline);

  return (
    <Link
      href={`/policy/${encodeURIComponent(policy.slug)}`}
      className="block p-4 rounded-xl border border-gray-200 dark:border-[#333] bg-white dark:bg-[#1a1a1a] hover:border-green-300 dark:hover:border-green-700 hover:shadow-md transition-all group"
    >
      <p className="text-sm font-bold text-gray-900 dark:text-white group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors line-clamp-2 mb-1">
        {policy.title}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        {policy.provider}
      </p>
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[60%]">
          {policy.category || '정부지원'}
        </span>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
          deadline.isExpired
            ? 'text-gray-400 bg-gray-100 dark:bg-gray-800'
            : deadline.urgency === 'urgent'
              ? 'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400'
              : 'text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400'
        }`}>
          {deadline.label}
        </span>
      </div>
    </Link>
  );
}
