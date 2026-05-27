'use client';
// components/PolicyChecklist.tsx
// ────────────────────────────────────────────────────────────
// 🌟 내 정책 체크리스트 — 저장한 정책 관리 + 마감 임박 배지
// ────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronUp, Trash2, ExternalLink, ClipboardList } from 'lucide-react';
import {
  getSavedPolicies, updateStatus, removePolicy, clearAll, getDaysLeft,
  type SavedPolicy,
} from '@/lib/policyChecklist';

const STATUS_LABELS: Record<SavedPolicy['status'], { emoji: string; label: string; next: SavedPolicy['status'] }> = {
  pending:   { emoji: '⬜', label: '신청예정', next: 'preparing' },
  preparing: { emoji: '🔄', label: '서류준비', next: 'done' },
  done:      { emoji: '✅', label: '완료',     next: 'pending' },
};

export default function PolicyChecklist() {
  const [policies, setPolicies] = useState<SavedPolicy[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const refresh = useCallback(() => setPolicies(getSavedPolicies()), []);

  useEffect(() => { refresh(); }, [refresh]);

  // 외부에서 저장 후 리프레시할 수 있도록 커스텀 이벤트 수신
  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener('checklist-updated', handler);
    return () => window.removeEventListener('checklist-updated', handler);
  }, [refresh]);

  const urgentCount = policies.filter(p => {
    if (p.status === 'done') return false;
    const d = getDaysLeft(p.deadline);
    return d !== null && d >= 0 && d <= 7;
  }).length;

  if (policies.length === 0) return null;

  const sorted = [...policies].sort((a, b) => {
    // 완료는 아래로
    if (a.status === 'done' && b.status !== 'done') return 1;
    if (a.status !== 'done' && b.status === 'done') return -1;
    // D-day 임박 순
    const da = getDaysLeft(a.deadline) ?? 9999;
    const db = getDaysLeft(b.deadline) ?? 9999;
    return da - db;
  });

  return (
    <div className="mx-4 mb-3 rounded-xl border border-green-300 dark:border-green-800/50 bg-green-50/50 dark:bg-green-900/10 overflow-hidden">
      {/* 헤더 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-bold text-green-800 dark:text-green-300 hover:bg-green-100/50 dark:hover:bg-green-900/20 transition-colors"
      >
        <span className="flex items-center gap-2">
          <ClipboardList size={16} />
          내 정책 체크리스트 ({policies.length}건)
          {urgentCount > 0 && (
            <span className="px-2 py-0.5 text-xs font-bold bg-red-500 text-white rounded-full animate-pulse">
              D-7 이내 {urgentCount}건
            </span>
          )}
        </span>
        {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {/* 목록 */}
      {isOpen && (
        <div className="px-4 pb-3 space-y-2">
          {sorted.map((p) => {
            const daysLeft = getDaysLeft(p.deadline);
            const isUrgent = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7 && p.status !== 'done';
            const isExpired = daysLeft !== null && daysLeft < 0;
            const st = STATUS_LABELS[p.status];

            return (
              <div
                key={p.id}
                className={`flex items-start gap-2 rounded-lg p-2.5 text-sm transition-colors ${
                  isUrgent
                    ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40'
                    : p.status === 'done'
                    ? 'bg-gray-50 dark:bg-gray-800/30 opacity-60'
                    : 'bg-white dark:bg-[#1e1e1e] border border-gray-100 dark:border-[#333]'
                }`}
              >
                {/* 상태 토글 */}
                <button
                  onClick={() => { updateStatus(p.id, st.next); refresh(); }}
                  className="mt-0.5 shrink-0 text-lg hover:scale-110 transition-transform"
                  title={`${st.label} → ${STATUS_LABELS[st.next].label}`}
                >
                  {st.emoji}
                </button>

                {/* 정책 정보 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`font-semibold truncate ${p.status === 'done' ? 'line-through text-gray-400' : 'text-gray-800 dark:text-gray-100'}`}>
                      {p.title}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                      {p.provider}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs">
                    <span className={`font-medium ${
                      isExpired ? 'text-gray-400 line-through' :
                      isUrgent ? 'text-red-600 dark:text-red-400 font-bold' :
                      'text-gray-500 dark:text-gray-400'
                    }`}>
                      {daysLeft !== null
                        ? (isExpired ? '마감됨' : daysLeft === 0 ? '⚡ 오늘 마감!' : `D-${daysLeft}`)
                        : '상시모집'}
                    </span>
                    <span className="text-gray-300 dark:text-gray-600">·</span>
                    <span className="text-gray-400">{st.label}</span>
                  </div>
                </div>

                {/* 링크 + 삭제 */}
                <div className="flex items-center gap-1 shrink-0">
                  {p.url && (
                    <a href={p.url} target="_blank" rel="noopener noreferrer"
                      className="p-1 rounded hover:bg-gray-100 dark:hover:bg-[#333] text-gray-400 hover:text-blue-500 transition-colors"
                      title="공식 사이트 열기">
                      <ExternalLink size={14} />
                    </a>
                  )}
                  <button
                    onClick={() => { removePolicy(p.id); refresh(); }}
                    className="p-1 rounded hover:bg-gray-100 dark:hover:bg-[#333] text-gray-400 hover:text-red-500 transition-colors"
                    title="삭제">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}

          {/* 전체 삭제 */}
          <button
            onClick={() => { if (confirm('체크리스트를 모두 지울까요?')) { clearAll(); refresh(); } }}
            className="w-full text-xs text-gray-400 hover:text-red-400 py-1 transition-colors"
          >
            전체 삭제
          </button>
        </div>
      )}
    </div>
  );
}
