// app/admin/dashboard/page.tsx
"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Users, UserPlus, MessageSquare, AlertOctagon, Calendar, Activity, RefreshCw, MessageCircle, Database, Plus, Edit, Trash2, X, Save, Bot, Landmark } from "lucide-react";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, AreaChart, Area
} from "recharts";

// --- 타입 정의 ---
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

interface ActiveUserStats {
  today: number;
  week: number;
  month: number;
}

interface Policy {
  id?: string;
  policy_id?: string;
  title: string;
  provider: string;
  target_audience: string;
  age_req?: string;
  income_req?: string;
  region_req: string;
  summary?: string;
  url?: string;
  is_auto?: boolean; // 🌟 AI 수집 여부
  updated_at?: string;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#ec4899'];

// 기본 빈 폼 데이터
const EMPTY_POLICY: Policy = { title: "", provider: "", target_audience: "", age_req: "", income_req: "", region_req: "", summary: "", url: "" };

export default function AdminDashboardPage() {
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // 메인 탭 상태
  const [activeTab, setActiveTab] = useState<'stats' | 'db'>('stats');
  // DB 서브 탭 상태 (공식 vs AI수집)
  const [dbSubTab, setDbSubTab] = useState<'official' | 'agent'>('official');

  // 통계/데이터 상태
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activeUsers, setActiveUsers] = useState<ActiveUserStats>({ today: 0, week: 0, month: 0 }); // 🌟 신규: 활성 유저 상태
  const [officialPolicies, setOfficialPolicies] = useState<Policy[]>([]);
  const [agentPolicies, setAgentPolicies] = useState<Policy[]>([]);

  // 모달 폼 상태
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<Policy>(EMPTY_POLICY);

  // 🌟 [수정됨] 통계 불러오기 (기존 통계 + 활성 유저 통계 동시 호출)
  // 클라이언트의 useEffect 내부이므로 매번 새롭게 통신합니다. (API 캐싱만 없으면 완벽!)
  const fetchStats = async () => {
    setLoading(true);
    try {
      const [statsData, activeUsersData] = await Promise.all([
        api.getAdminStats(),
        api.getActiveUserStats() // 우리가 만든 신규 API 호출!
      ]);
      setStats(statsData as DashboardStats);
      setActiveUsers(activeUsersData);
    } catch (error) {
      console.error("통계 불러오기 실패:", error);
    } finally {
      setLoading(false);
    }
  };

  // 정책 리스트 불러오기
  const fetchPolicies = async () => {
    setLoading(true);
    try {
      const res = await api.getAdminPolicies(); 
      if (res && res.data) {
        setOfficialPolicies(res.data.official || []);
        setAgentPolicies(res.data.agent_collected || []);
      }
    } catch (error) {
      console.error("정책 불러오기 실패:", error);
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

  // 탭 전환 핸들러
  const handleTabChange = (tab: 'stats' | 'db') => {
    setActiveTab(tab);
    if (tab === 'db') fetchPolicies();
    else fetchStats();
  };

  if (!isAdminAuthenticated) return null;

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

  const currentPolicies = dbSubTab === 'official' ? officialPolicies : agentPolicies;

  return (
    <div className="min-h-screen bg-[#121212] text-gray-100 p-4 sm:p-8 font-sans overflow-y-auto">
      <div className="max-w-6xl mx-auto space-y-6 pb-20">
        
        {/* 헤더 섹션 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-3">
              <Activity className="text-blue-500" size={32} />
              정책 내비게이터 최고 관리자
            </h1>
            <p className="text-gray-400 mt-2 flex items-center gap-2">
              <Calendar size={16} /> 오늘 날짜: {stats?.today_date || new Date().toISOString().split('T')[0]}
            </p>
          </div>
          <button 
            onClick={() => handleTabChange(activeTab)}
            className="flex items-center justify-center gap-2 bg-[#1e1e1e] hover:bg-[#2a2a2a] border border-gray-700 text-white px-5 py-2.5 rounded-xl transition-all shadow-sm"
          >
            <RefreshCw size={18} className={loading ? "animate-spin text-blue-400" : "text-blue-400"} />
            새로고침
          </button>
        </div>

        {/* 메인 탭 네비게이션 */}
        <div className="flex gap-2 border-b border-gray-800 pt-4">
          <button 
            onClick={() => handleTabChange('stats')}
            className={`px-6 py-3 font-bold flex items-center gap-2 transition-colors ${activeTab === 'stats' ? 'text-blue-400 border-b-2 border-blue-500' : 'text-gray-500 hover:text-gray-300'}`}
          >
            <Activity size={18} /> 서비스 통계
          </button>
          <button 
            onClick={() => handleTabChange('db')}
            className={`px-6 py-3 font-bold flex items-center gap-2 transition-colors ${activeTab === 'db' ? 'text-green-400 border-b-2 border-green-500' : 'text-gray-500 hover:text-gray-300'}`}
          >
            <Database size={18} /> 정책 DB 관리
          </button>
        </div>

        {/* ========================================================= */}
        {/* 탭 1: 통계 보기 */}
        {/* ========================================================= */}
        {activeTab === 'stats' && (
          <div className="space-y-6 animate-in fade-in duration-300 pt-4">
            
            {/* 🌟 신규: 유저 활성도 (DAU, WAU, MAU, Total) 카드 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-[#1e1e1e] border border-gray-800 rounded-2xl p-5 shadow-lg flex flex-col transition-transform hover:-translate-y-1">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2.5 bg-blue-500/10 rounded-lg"><Activity size={20} className="text-blue-500" /></div>
                  <h2 className="text-gray-400 text-sm font-semibold">오늘 접속 유저 (DAU)</h2>
                </div>
                <div className="text-3xl font-extrabold text-white mt-auto">{loading ? "-" : activeUsers.today.toLocaleString()} <span className="text-base text-gray-500 font-medium">명</span></div>
              </div>

              <div className="bg-[#1e1e1e] border border-gray-800 rounded-2xl p-5 shadow-lg flex flex-col transition-transform hover:-translate-y-1">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2.5 bg-green-500/10 rounded-lg"><Calendar size={20} className="text-green-500" /></div>
                  <h2 className="text-gray-400 text-sm font-semibold">이번 주 유저 (WAU)</h2>
                </div>
                <div className="text-3xl font-extrabold text-white mt-auto">{loading ? "-" : activeUsers.week.toLocaleString()} <span className="text-base text-gray-500 font-medium">명</span></div>
              </div>

              <div className="bg-[#1e1e1e] border border-gray-800 rounded-2xl p-5 shadow-lg flex flex-col transition-transform hover:-translate-y-1">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2.5 bg-purple-500/10 rounded-lg"><Users size={20} className="text-purple-500" /></div>
                  <h2 className="text-gray-400 text-sm font-semibold">한 달 유저 (MAU)</h2>
                </div>
                <div className="text-3xl font-extrabold text-white mt-auto">{loading ? "-" : activeUsers.month.toLocaleString()} <span className="text-base text-gray-500 font-medium">명</span></div>
              </div>

              <div className="bg-[#1e1e1e] border border-gray-800 rounded-2xl p-5 shadow-lg flex flex-col transition-transform hover:-translate-y-1">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2.5 bg-blue-500/10 rounded-lg"><UserPlus size={20} className="text-blue-500" /></div>
                  <h2 className="text-gray-400 text-sm font-semibold">총 누적 사용자</h2>
                </div>
                <div className="text-3xl font-extrabold text-white mt-auto">{loading ? "-" : (stats?.total_users || 0).toLocaleString()} <span className="text-base text-gray-500 font-medium">명</span></div>
              </div>
            </div>

            {/* 기존: 시스템 통계 (대화방, 티키타카, 방어) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-[#1e1e1e] border border-gray-800 rounded-2xl p-5 shadow-lg flex flex-col transition-transform hover:-translate-y-1">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2.5 bg-green-500/10 rounded-lg"><MessageSquare size={20} className="text-green-500" /></div>
                  <h2 className="text-gray-400 text-sm font-semibold">총 생성된 대화방</h2>
                </div>
                <div className="text-3xl font-extrabold text-white mt-auto">{loading ? "-" : (stats?.total_threads || 0).toLocaleString()} <span className="text-base text-gray-500 font-medium">개</span></div>
              </div>

              <div className="bg-[#1e1e1e] border border-purple-900/30 rounded-2xl p-5 shadow-lg flex flex-col transition-transform hover:-translate-y-1">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2.5 bg-purple-500/10 rounded-lg"><MessageCircle size={20} className="text-purple-500" /></div>
                  <h2 className="text-gray-400 text-sm font-semibold">유저 평균 티키타카</h2>
                </div>
                <div className="text-3xl font-extrabold text-purple-400 mt-auto">{loading ? "-" : (stats?.avg_conversation_depth || 0)} <span className="text-base text-purple-900/70 font-medium">턴</span></div>
              </div>

              <div className="bg-[#1e1e1e] border border-red-900/30 rounded-2xl p-5 shadow-lg flex flex-col transition-transform hover:-translate-y-1">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2.5 bg-red-500/10 rounded-lg"><AlertOctagon size={20} className="text-red-500" /></div>
                  <h2 className="text-gray-400 text-sm font-semibold">오늘 한도 초과 방어</h2>
                </div>
                <div className="text-3xl font-extrabold text-red-400 mt-auto">{loading ? "-" : (stats?.blocked_today || 0).toLocaleString()} <span className="text-base text-red-900/70 font-medium">건</span></div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                  ) : <div className="h-full flex items-center justify-center text-gray-500">데이터 없음</div>}
                </div>
              </div>

              <div className="bg-[#1e1e1e] border border-gray-800 rounded-2xl p-6 shadow-lg">
                <h2 className="text-lg font-bold text-white mb-6">🎂 주력 연령대 분포</h2>
                <div className="h-64 w-full">
                  {stats?.age_distribution && stats.age_distribution.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={stats.age_distribution} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={5} dataKey="value" label={({name, percent}) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                          {stats.age_distribution.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="rgba(0,0,0,0)" />)}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : <div className="h-full flex items-center justify-center text-gray-500">데이터 없음</div>}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="bg-[#1e1e1e] border border-gray-800 rounded-2xl p-6 shadow-lg lg:col-span-2">
                <h2 className="text-lg font-bold text-white mb-6">🕒 시간대별 트래픽</h2>
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
                  ) : <div className="h-full flex items-center justify-center text-gray-500">데이터 없음</div>}
                </div>
              </div>

              <div className="bg-[#1e1e1e] border border-gray-800 rounded-2xl p-6 shadow-lg flex flex-col">
                <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">🔥 유저 핫 키워드</h2>
                <p className="text-xs text-gray-500 mb-4">'추가 정보' 최다 언급 단어</p>
                <div className="flex-1 flex flex-wrap content-start gap-2 overflow-y-auto">
                  {stats?.top_keywords && stats.top_keywords.length > 0 ? (
                    stats.top_keywords.map((kw, idx) => (
                      <div key={idx} className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${idx < 3 ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' : 'bg-gray-800 text-gray-300 border-gray-700'}`}>
                        # {kw.keyword} <span className="opacity-50 text-xs ml-1">{kw.count}</span>
                      </div>
                    ))
                  ) : <div className="w-full py-10 flex items-center justify-center text-gray-500 text-sm">데이터 없음</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* 탭 2: 정책 DB 관리 */}
        {/* ========================================================= */}
        {activeTab === 'db' && (
          <div className="space-y-6 animate-in fade-in duration-300 pt-4">
            
            <div className="flex justify-between items-center bg-[#1e1e1e] p-6 rounded-2xl border border-gray-800 shadow-sm">
              <div>
                <h2 className="text-xl font-bold text-white">DB 정책 리스트</h2>
                <p className="text-gray-400 text-sm mt-1">
                  총 <span className="text-white font-bold">{officialPolicies.length + agentPolicies.length}</span>개의 정책이 저장되어 있습니다.
                </p>
              </div>
              <button 
                onClick={() => { setFormData(EMPTY_POLICY); setShowForm(true); }}
                className="bg-green-600 hover:bg-green-500 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-colors shadow-lg"
              >
                <Plus size={18} /> 새 정책 수동 추가
              </button>
            </div>

            <div className="flex gap-2 bg-[#1a1a1a] p-1 rounded-xl border border-gray-800 w-fit">
              <button 
                onClick={() => setDbSubTab('official')}
                className={`px-4 py-2 text-sm font-bold rounded-lg flex items-center gap-2 transition-all ${dbSubTab === 'official' ? 'bg-[#2a2a2a] text-blue-400 shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
              >
                <Landmark size={16} /> 🏛️ 공식 등록 데이터 ({officialPolicies.length})
              </button>
              <button 
                onClick={() => setDbSubTab('agent')}
                className={`px-4 py-2 text-sm font-bold rounded-lg flex items-center gap-2 transition-all ${dbSubTab === 'agent' ? 'bg-[#2a2a2a] text-purple-400 shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}
              >
                <Bot size={16} /> 🤖 AI 스텔스 수집 ({agentPolicies.length})
              </button>
            </div>

            <div className="bg-[#1e1e1e] rounded-2xl border border-gray-800 overflow-hidden shadow-lg">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-[#2a2a2a] text-gray-400">
                    <tr>
                      <th className="px-6 py-4 font-semibold">정책명</th>
                      <th className="px-6 py-4 font-semibold">제공 기관</th>
                      <th className="px-6 py-4 font-semibold">대상 / 지역</th>
                      <th className="px-6 py-4 font-semibold">최종 업데이트</th>
                      <th className="px-6 py-4 font-semibold text-right">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800 text-gray-300">
                    {loading ? (
                      <tr><td colSpan={5} className="px-6 py-10 text-center text-gray-500 animate-pulse">데이터를 불러오는 중입니다...</td></tr>
                    ) : currentPolicies.length === 0 ? (
                      <tr><td colSpan={5} className="px-6 py-10 text-center text-gray-500">해당 분류에 등록된 정책이 없습니다.</td></tr>
                    ) : (
                      currentPolicies.map((p, idx) => (
                        <tr key={idx} className="hover:bg-[#252525] transition-colors">
                          <td className="px-6 py-4 font-medium text-white flex items-center gap-2">
                            {p.title}
                            {p.is_auto && <span className="bg-purple-900/50 text-purple-300 text-[10px] px-2 py-0.5 rounded border border-purple-700">AI수집</span>}
                          </td>
                          <td className="px-6 py-4">{p.provider}</td>
                          <td className="px-6 py-4 text-gray-400">{p.target_audience} <span className="mx-2 text-gray-700">|</span> {p.region_req}</td>
                          <td className="px-6 py-4 text-gray-500 text-xs">{p.updated_at?.split(' ')[0]}</td>
                          <td className="px-6 py-4 text-right space-x-3">
                            <button className="text-blue-400 hover:text-blue-300 transition-colors" onClick={() => { setFormData(p); setShowForm(true); }}><Edit size={18} className="inline" /></button>
                            <button className="text-red-400 hover:text-red-300 transition-colors"><Trash2 size={18} className="inline" /></button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-[#1e1e1e] border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex justify-between items-center p-6 border-b border-gray-800">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Database className="text-green-500" size={20}/> {formData.id || formData.policy_id ? "정책 수정하기" : "새 정책 등록하기"}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white p-1"><X size={24} /></button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-4 flex-1 custom-scrollbar">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400">정책명 (필수)</label>
                  <input type="text" className="w-full bg-[#2a2a2a] border border-gray-700 rounded-lg px-4 py-2.5 text-white outline-none focus:border-green-500" placeholder="예: 청년도약계좌" value={formData.title} onChange={(e) => setFormData({...formData, title: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400">제공 기관 (필수)</label>
                  <input type="text" className="w-full bg-[#2a2a2a] border border-gray-700 rounded-lg px-4 py-2.5 text-white outline-none focus:border-green-500" placeholder="예: 서민금융진흥원" value={formData.provider} onChange={(e) => setFormData({...formData, provider: e.target.value})} />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400">주요 타겟 대상</label>
                <input type="text" className="w-full bg-[#2a2a2a] border border-gray-700 rounded-lg px-4 py-2.5 text-white outline-none focus:border-green-500" placeholder="예: 만 19세~34세 무주택 청년" value={formData.target_audience} onChange={(e) => setFormData({...formData, target_audience: e.target.value})} />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400">나이 조건</label>
                  <input type="text" className="w-full bg-[#2a2a2a] border border-gray-700 rounded-lg px-4 py-2.5 text-white outline-none focus:border-green-500" placeholder="예: 19-34" value={formData.age_req} onChange={(e) => setFormData({...formData, age_req: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400">소득 조건</label>
                  <input type="text" className="w-full bg-[#2a2a2a] border border-gray-700 rounded-lg px-4 py-2.5 text-white outline-none focus:border-green-500" placeholder="예: 연소득 7500만원 이하" value={formData.income_req} onChange={(e) => setFormData({...formData, income_req: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400">지역 조건</label>
                  <input type="text" className="w-full bg-[#2a2a2a] border border-gray-700 rounded-lg px-4 py-2.5 text-white outline-none focus:border-green-500" placeholder="예: 전국 또는 서울" value={formData.region_req} onChange={(e) => setFormData({...formData, region_req: e.target.value})} />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400">공식 신청 링크 (URL)</label>
                <input type="url" className="w-full bg-[#2a2a2a] border border-gray-700 rounded-lg px-4 py-2.5 text-white outline-none focus:border-green-500" placeholder="https://" value={formData.url} onChange={(e) => setFormData({...formData, url: e.target.value})} />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400">정책 상세 요약 (AI가 읽을 부분! 상세히 적어주세요)</label>
                <textarea rows={4} className="w-full bg-[#2a2a2a] border border-gray-700 rounded-lg px-4 py-3 text-white outline-none focus:border-green-500 resize-none" placeholder="어떤 혜택을 주는지, 주의사항은 무엇인지 자세히 적어주세요." value={formData.summary} onChange={(e) => setFormData({...formData, summary: e.target.value})} />
              </div>
            </div>

            <div className="p-6 border-t border-gray-800 bg-[#1a1a1a] rounded-b-2xl flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="px-5 py-2.5 rounded-xl font-bold text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">취소</button>
              <button onClick={() => alert("다음 단계에서 수정/삭제 백엔드 API 연결할게! 😎")} className="bg-green-600 hover:bg-green-500 text-white px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-lg transition-transform active:scale-95">
                <Save size={18} /> 저장하기
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
