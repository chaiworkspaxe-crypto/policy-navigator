// lib/policyChecklist.ts
// ────────────────────────────────────────────────────────────
// 🌟 내 정책 체크리스트 — localStorage CRUD + 마감 배지
// ────────────────────────────────────────────────────────────

export interface SavedPolicy {
  id: string;
  title: string;
  provider: string;
  url: string;
  deadline: string | null;
  category: string | null;
  status: 'pending' | 'preparing' | 'done';
  savedAt: string;
}

const STORAGE_KEY = 'policyai_checklist';

function getAll(): SavedPolicy[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveAll(policies: SavedPolicy[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(policies));
  } catch (e) { console.error('[checklist] save error', e); }
}

export function getSavedPolicies(): SavedPolicy[] {
  return getAll();
}

export function addPolicies(items: Omit<SavedPolicy, 'id' | 'status' | 'savedAt'>[]): number {
  const existing = getAll();
  const existingKeys = new Set(existing.map(p => `${p.title}|${p.provider}`.toLowerCase()));
  const now = new Date().toISOString();
  let added = 0;
  for (const item of items) {
    const key = `${item.title}|${item.provider}`.toLowerCase();
    if (existingKeys.has(key)) continue;
    existing.push({
      ...item,
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: 'pending',
      savedAt: now,
    });
    existingKeys.add(key);
    added++;
  }
  saveAll(existing);
  return added;
}

export function updateStatus(id: string, status: SavedPolicy['status']) {
  const all = getAll();
  const target = all.find(p => p.id === id);
  if (target) { target.status = status; saveAll(all); }
}

export function removePolicy(id: string) {
  saveAll(getAll().filter(p => p.id !== id));
}

export function clearAll() {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

export function getDaysLeft(deadline: string | null): number | null {
  if (!deadline) return null;
  const d = Date.parse(deadline);
  if (isNaN(d)) return null;
  return Math.ceil((d - Date.now()) / (24 * 3600_000));
}

/** 어시스턴트 응답의 마크다운 테이블에서 정책 목록 추출 */
export function parsePoliciesFromTable(text: string): Omit<SavedPolicy, 'id' | 'status' | 'savedAt'>[] {
  const lines = text.split('\n');
  const results: Omit<SavedPolicy, 'id' | 'status' | 'savedAt'>[] = [];
  let inTable = false;

  for (const line of lines) {
    const t = line.trim();
    // 표가 시작되지 않았거나, 테이블 포맷이 아니면 스킵
    if (!t.startsWith('|')) { 
      if (inTable && results.length > 0) break; 
      continue; 
    }
    // 헤더 구분선(|---|---|) 스킵
    if (t.includes('---')) { 
      inTable = true; 
      continue; 
    }
    // 첫 번째 줄(헤더 제목) 스킵
    if (!inTable) { 
      inTable = true; 
      continue; 
    } 

    // 🌟 [핵심 버그 수정] 양끝의 '|' 기호만 제거하고 split. filter(Boolean) 제거!
    // 이렇게 해야 빈 칸(empty cell)이 있어도 배열 인덱스가 어긋나지 않습니다.
    const rowContent = t.replace(/^\||\|$/g, ''); 
    const cells = rowContent.split('|').map(c => c.replace(/\*+/g, '').trim());
    
    // 기본적으로 [분야, 정책명, 주관기관, 혜택, 마감일] 최소 3칸 이상이어야 유효한 데이터로 간주
    if (cells.length < 3) continue;

    const category = cells[0] || null;
    const title = cells[1] || '';
    const provider = cells[2] || '';
    
    if (!title || title.length < 2) continue;

    // 마감일 추출: "2026-04-10" 형식 찾기
    let deadline: string | null = null;
    const lastCell = cells[cells.length - 1] || '';
    if (/\d{4}[-/]\d{2}[-/]\d{2}/.test(lastCell)) {
      const m = lastCell.match(/\d{4}[-/]\d{2}[-/]\d{2}/);
      if (m && m[0]) deadline = m[0];
    }

    // URL 추출: 셀 내 (https://...)
    let url = '';
    for (const c of cells) {
      const um = c.match(/https?:\/\/[^\s)]+/);
      if (um && um[0]) { url = um[0]; break; }
    }

    results.push({ title, provider, url, deadline, category });
  }
  return results;
}
