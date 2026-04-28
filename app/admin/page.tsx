"use client";

import { useState, useEffect } from "react";
import { Users, MessageSquare, AlertTriangle, RefreshCcw, Lock } from "lucide-react";

export default function AdminDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetchStats = async () => {
    setLoading(true);
    try {
      // 🌟 변경 후: 상대 경로(/api/...)를 사용하여 Next.js 내부 API를 직접 호출하도록 수정 완료!
      const res = await fetch('/api/admin/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data.data);
      }
    } catch (err) {
      console.error("통계 로드 실패:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === "admin1234") { // 🌟 운영자용 임시 비밀번호
      setIsAuthenticated(true);
      fetchStats();
    } else {
      alert("비밀번호가 틀렸습니다.");
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <form onSubmit={handleLogin} className="bg-white p-8 rounded-2xl shadow-lg max-w-sm w-full space-y-4">
          <div className="flex justify-center mb-4 text-green-600"><Lock size={48} /></div>
          <h1 className="text-2xl font-bold text-center text-gray-800">관리자 대시보드</h1>
          <input 
            type="password" 
            placeholder="비밀번호 입력" 
            className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:border-green-500"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" className="w-full bg-green-600 text-white font-bold py-3 rounded-lg hover:bg-green-700 transition">
            접속하기
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 p-4 sm:p-8 font-sans">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">운영 현황 대시보드</h1>
            <p className="text-gray-500 mt-1">
              기준일: {stats?.today_date || "로딩 중..."}
            </p>
          </div>
          <button 
            onClick={fetchStats}
            disabled={loading}
            className="flex items-center gap-2 bg-white border border-gray-300 px-4 py-2 rounded-lg shadow-sm hover:bg-gray-50 transition active:scale-95 disabled:opacity-50"
          >
            <RefreshCcw size={16} className={loading ? "animate-spin" : ""} />
            새로고침
          </button>
        </div>

        {stats ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-start gap-4">
              <div className="p-3 bg-blue-100 text-blue-600 rounded-xl"><Users size={24} /></div>
              <div>
                <p className="text-sm font-medium text-gray-500">누적 접속 유저</p>
                <p className="text-3xl font-bold mt-1">{stats.total_users}명</p>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-start gap-4">
              <div className="p-3 bg-green-100 text-green-600 rounded-xl"><MessageSquare size={24} /></div>
              <div>
                <p className="text-sm font-medium text-gray-500">총 생성된 대화방</p>
                <p className="text-3xl font-bold mt-1">{stats.total_threads}개</p>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-red-100 flex items-start gap-4">
              <div className="p-3 bg-red-100 text-red-600 rounded-xl"><AlertTriangle size={24} /></div>
              <div>
                <p className="text-sm font-medium text-gray-500">오늘 제한된 어뷰저</p>
                <p className="text-3xl font-bold mt-1 text-red-600">{stats.blocked_today}명</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="py-20 text-center text-gray-400 font-medium animate-pulse">
            통계 데이터를 불러오는 중입니다...
          </div>
        )}
      </div>
    </div>
  );
}
