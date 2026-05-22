// app/policy/[slug]/not-found.tsx
import Link from 'next/link';

export default function PolicyNotFound() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0e0e0e] flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <div className="text-6xl mb-4">🔍</div>
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white mb-3">
          정책을 찾을 수 없습니다
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mb-6 text-sm leading-relaxed">
          해당 정책이 마감되었거나, 주소가 변경되었을 수 있어요.
          <br />
          AI에게 직접 물어보면 더 빠르게 찾을 수 있어요!
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded-full transition-colors shadow-lg"
        >
          🔍 AI에게 맞춤 혜택 물어보기
        </Link>
      </div>
    </div>
  );
}
