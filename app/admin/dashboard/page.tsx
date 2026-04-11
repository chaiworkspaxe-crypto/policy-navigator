"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Users, MessageSquare, AlertOctagon, Calendar, Activity, RefreshCw } from "lucide-react";

interface DashboardStats {
  total_users: number;
  total_threads: number;
  blocked_today: number;
  today_date: string;
}

export default function AdminDashboardPage() {
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 🌟 보안: 비밀번호 확인
    const password = window.prompt("관리자 비밀번호를 입력하세요.");
    if (password === "8011") {
      setIsAdminAuthenticated(true);
      fetchStats();
      document.documentElement.classList.add('dark'); // 대시보드는 다크모드가 간지!
    } else {
      alert("접근 권한이 없습니다.");
      window.location.href = "/";
    }
  }, []);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const data = await api.getAdminStats();
      setStats(data);
    } catch (error) {
      console.error("통계 불러오기 실패:", error);
      alert("데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  if (!isAdminAuthenticated) return null;

  return (
    <div className="min-h-screen bg-[#121212] text-gray-100 p-6 sm:p-10 font-sans">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* 헤더 섹션 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-800 pb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-3">
              <Activity className="text-red-500" size={32} />
              정책 내비게이터 운영 대시보드
            </h1>
            <p className="text-gray-400 mt-2 flex items-center gap-2">
              <Calendar size={16} /> 기준일: {stats?.today_date || "로딩 중..."}
            </p>
          </div>
          <button 
            onClick={fetchStats}
            className="flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white px-4 py-2.5 rounded-xl transition-all shadow-sm"
          >
            <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
            {loading ? "불러오는 중..." : "데이터 새로고침"}
          </button>
        </div>

        {/* 통계 카드 그리드 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          
          {/* 카드 1: 누적 사용자 */}
          <div className="bg-[#1e1e1e] border border-gray-800 rounded-2xl p-6 shadow-lg flex flex-col items-center sm:items-start text-center sm:text-left transition-transform hover:-translate-y-1">
            <div className="p-3 bg-blue-500/10 rounded-xl mb-4">
              <Users size={28} className="text-blue-500" />
            </div>
            <h2 className="text-gray-400 text-sm font-semibold mb-1">총 누적 사용자 (세션)</h2>
            <div className="text-4xl font-extrabold text-white">
              {loading ? "-" : stats?.total_users.toLocaleString()} <span className="text-lg text-gray-500 font-medium">명</span>
            </div>
          </div>

          {/* 카드 2: 생성된 대화방 */}
          <div className="bg-[#1e1e1e] border border-gray-800 rounded-2xl p-6 shadow-lg flex flex-col items-center sm:items-start text-center sm:text-left transition-transform hover:-translate-y-1">
            <div className="p-3 bg-green-500/10 rounded-xl mb-4">
              <MessageSquare size={28} className="text-green-500" />
            </div>
            <h2 className="text-gray-400 text-sm font-semibold mb-1">총 생성된 대화방 수</h2>
            <div className="text-4xl font-extrabold text-white">
              {loading ? "-" : stats?.total_threads.toLocaleString()} <span className="text-lg text-gray-500 font-medium">개</span>
            </div>
          </div>

          {/* 카드 3: 일일 제한 도달 (방어 지표) */}
          <div className="bg-[#1e1e1e] border border-red-900/30 rounded-2xl p-6 shadow-lg flex flex-col items-center sm:items-start text-center sm:text-left transition-transform hover:-translate-y-1">
            <div className="p-3 bg-red-500/10 rounded-xl mb-4">
              <AlertOctagon size={28} className="text-red-500" />
            </div>
            <h2 className="text-gray-400 text-sm font-semibold mb-1">오늘 횟수 제한(4회) 도달 유저</h2>
            <div className="text-4xl font-extrabold text-red-400">
              {loading ? "-" : stats?.blocked_today.toLocaleString()} <span className="text-lg text-red-900 font-medium">명</span>
            </div>
            <p className="text-xs text-gray-500 mt-2">API 비용 방어선 작동 횟수</p>
          </div>

        </div>

      </div>
    </div>
  );
}
