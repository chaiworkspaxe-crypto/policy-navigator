"use client";
// Vercel 강제 업데이트용

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Users, MessageSquare, AlertOctagon, Calendar, Activity, RefreshCw, MessageCircle } from "lucide-react";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, LineChart, Line, AreaChart, Area
} from "recharts";

// 🌟 [수정] 백엔드에서 보내주는 확장된 데이터 타입 정의
interface DashboardStats {
  total_users: number;
  total_threads: number;
  blocked_today: number;
  today_date: string;
  avg_conversation_depth: number;
  region_ranking: { name: string; value: number }[];
  age_distribution: { name: string; value: number }[];
  time_traffic: { hour: string; count: number }[];
  top_keywords: { keyword: string; count: number }[];
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#ec4899'];

export default function AdminDashboardPage() {
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const data = await api.getAdminStats();
      setStats(data as DashboardStats);
    } catch (error) {
      console.error("통계 불러오기 실패:", error);
      alert("데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const password = window.prompt("관리자 비밀번호를 입력하세요.");
    if (password === "8011") {
      setIsAdminAuthenticated(true);
      fetchStats();
      document.documentElement.classList.add('dark');
    } else {
      alert("접근 권한이 없습니다.");
      window.location.href = "/";
    }
  }, []);

  if (!isAdminAuthenticated) return null;

  // 커스텀 툴팁 (다크모드용)
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-[#2a2a2a] border border-[#444] p-3 rounded-lg shadow-xl">
          <p className="text-gray-300 mb-1">{label}</p>
          <p className="text-white font-bold">{payload[0].value} 건</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-[#121212] text-gray-100 p-4 sm:p-8 font-sans overflow-y-auto">
      <div className="max-w-6xl mx-auto space-y-8 pb-20">
        
        {/* 헤더 섹션 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-800 pb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-3">
              <Activity className="text-blue-500" size={32} />
              정책 내비게이터 운영 대시보드
            </h1>
            <p className="text-gray-400 mt-2 flex items-center gap-2">
              <Calendar size={16} /> 기준일: {stats?.today_date || "로딩 중..."}
            </p>
          </div>
          <button 
            onClick={fetchStats}
            className="flex items-center justify-center gap-2 bg-[#1e1e1e] hover:bg-[#2a2a2a] border border-gray-700 text-white px-5 py-2.5 rounded-xl transition-all shadow-sm"
          >
            <RefreshCw size={18} className={loading ? "animate-spin text-blue-400" : "text-blue-400"} />
            {loading ? "불러오는 중..." : "데이터 새로고침"}
          </button>
        </div>

        {/* 🌟 1. 최상단 핵심 지표 요약 (4개 카드) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[#1e1e1e] border border-gray-800 rounded-2xl p-5 shadow-lg flex flex-col transition-transform hover:-translate-y-1">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 bg-blue-500/10 rounded-lg"><Users size={20} className="text-blue-500" /></div>
              <h2 className="text-gray-400 text-sm font-semibold">총 누적 사용자</h2>
            </div>
            <div className="text-3xl font-extrabold text-white mt-auto">{loading ? "-" : stats?.total_users.toLocaleString()} <span className="text-base text-gray-500 font-medium">명</span></div>
          </div>

          <div className="bg-[#1e1e1e] border border-gray-800 rounded-2xl p-5 shadow-lg flex flex-col transition-transform hover:-translate-y-1">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 bg-green-500/10 rounded-lg"><MessageSquare size={20} className="text-green-500" /></div>
              <h2 className="text-gray-400 text-sm font-semibold">총 생성된 대화방</h2>
            </div>
            <div className="text-3xl font-extrabold text-white mt-auto">{loading ? "-" : stats?.total_threads.toLocaleString()} <span className="text-base text-gray-500 font-medium">개</span></div>
          </div>

          <div className="bg-[#1e1e1e] border border-purple-900/30 rounded-2xl p-5 shadow-lg flex flex-col transition-transform hover:-translate-y-1">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 bg-purple-500/10 rounded-lg"><MessageCircle size={20} className="text-purple-500" /></div>
              <h2 className="text-gray-400 text-sm font-semibold">유저 1인당 평균 대화</h2>
            </div>
            <div className="text-3xl font-extrabold text-purple-400 mt-auto">{loading ? "-" : stats?.avg_conversation_depth} <span className="text-base text-purple-900/70 font-medium">턴 (티키타카)</span></div>
          </div>

          <div className="bg-[#1e1e1e] border border-red-900/30 rounded-2xl p-5 shadow-lg flex flex-col transition-transform hover:-translate-y-1">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 bg-red-500/10 rounded-lg"><AlertOctagon size={20} className="text-red-500" /></div>
              <h2 className="text-gray-400 text-sm font-semibold">오늘 한도(4회) 초과</h2>
            </div>
            <div className="text-3xl font-extrabold text-red-400 mt-auto">{loading ? "-" : stats?.blocked_today.toLocaleString()} <span className="text-base text-red-900/70 font-medium">건 방어됨</span></div>
          </div>
        </div>

        {/* 🌟 2. 차트 섹션 (지역 랭킹 & 연령대) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 지역 랭킹 바 차트 */}
          <div className="bg-[#1e1e1e] border border-gray-800 rounded-2xl p-6 shadow-lg">
            <h2 className="text-lg font-bold text-white mb-6">📍 지역별 검색 랭킹 (Top 5)</h2>
            <div className="h-64 w-full">
              {stats?.region_ranking && stats.region_ranking.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.region_ranking} layout="vertical" margin={{ top: 0, right: 0, left: 20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" horizontal={true} vertical={false} />
                    <XAxis type="number" stroke="#888" fontSize={12} />
                    <YAxis dataKey="name" type="category" stroke="#ccc" fontSize={12} width={80} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={24} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500">데이터가 충분하지 않습니다.</div>
              )}
            </div>
          </div>

          {/* 연령대 파이 차트 */}
          <div className="bg-[#1e1e1e] border border-gray-800 rounded-2xl p-6 shadow-lg">
            <h2 className="text-lg font-bold text-white mb-6">🎂 주력 연령대 분포</h2>
            <div className="h-64 w-full">
              {stats?.age_distribution && stats.age_distribution.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={stats.age_distribution} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={5} dataKey="value" label={({name, percent}) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                      {stats.age_distribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="rgba(0,0,0,0)" />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500">데이터가 충분하지 않습니다.</div>
              )}
            </div>
          </div>
        </div>

        {/* 🌟 3. 차트 섹션 (시간대 트래픽 & 핫 키워드) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 시간대 트래픽 에어리어 차트 (2칸 차지) */}
          <div className="bg-[#1e1e1e] border border-gray-800 rounded-2xl p-6 shadow-lg lg:col-span-2">
            <h2 className="text-lg font-bold text-white mb-6">🕒 시간대별 트래픽 현황</h2>
            <div className="h-64 w-full">
              {stats?.time_traffic && stats.time_traffic.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={stats.time_traffic} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                    <XAxis dataKey="hour" stroke="#888" fontSize={12} />
                    <YAxis stroke="#888" fontSize={12} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="count" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorCount)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500">데이터가 충분하지 않습니다.</div>
              )}
            </div>
          </div>

          {/* 인기 키워드 태그 클라우드 (1칸 차지) */}
          <div className="bg-[#1e1e1e] border border-gray-800 rounded-2xl p-6 shadow-lg flex flex-col">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">🔥 유저 핫 키워드</h2>
            <p className="text-xs text-gray-500 mb-4">'추가 정보'에서 가장 많이 언급된 단어</p>
            <div className="flex-1 flex flex-wrap content-start gap-2 overflow-y-auto">
              {stats?.top_keywords && stats.top_keywords.length > 0 ? (
                stats.top_keywords.map((kw, idx) => (
                  <div key={idx} className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${idx < 3 ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' : 'bg-gray-800 text-gray-300 border-gray-700'}`}>
                    # {kw.keyword} <span className="opacity-50 text-xs ml-1">{kw.count}</span>
                  </div>
                ))
              ) : (
                <div className="w-full py-10 flex items-center justify-center text-gray-500 text-sm">데이터가 충분하지 않습니다.</div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
