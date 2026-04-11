"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { api, ChatMessage, extractApiErrorMessage, ThreadInputs, ThreadItem } from "@/lib/api";
import { CITY_TO_DISTRICTS, DONG_MAP } from "@/lib/regionData";
import MarkdownMessage from "@/components/MarkdownMessage";
import { MessageSquare, Plus, Send, Loader2, MapPin, Search, AlertCircle, Menu, X, Trash2, Sun, Moon, Coffee, ChevronUp, ChevronDown } from "lucide-react";

const DEFAULT_CITY = "선택하세요";
const DEFAULT_DONG = "선택 안 함";
const EMPTY_INPUTS: ThreadInputs = { selected_city: DEFAULT_CITY, selected_district: DEFAULT_CITY, selected_dong: DEFAULT_DONG, birth_year: "", extra_info: "" };

export default function Home() {
  const [userId, setUserId] = useState("");
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [aiStatus, setAiStatus] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showDonation, setShowDonation] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isFormExpanded, setIsFormExpanded] = useState(true);

  const [city, setCity] = useState(EMPTY_INPUTS.selected_city);
  const [district, setDistrict] = useState(EMPTY_INPUTS.selected_district);
  const [dong, setDong] = useState(EMPTY_INPUTS.selected_dong);
  const [birthYear, setBirthYear] = useState(EMPTY_INPUTS.birth_year);
  const [extraInfo, setExtraInfo] = useState(EMPTY_INPUTS.extra_info);
  const [query, setQuery] = useState("");

  const wsRef = useRef<WebSocket | null>(null);

  const availableDistricts = useMemo(() => CITY_TO_DISTRICTS[city] || [], [city]);
  const availableDongs = useMemo(() => DONG_MAP[`${city}-${district}`] || [], [city, district]);

  useEffect(() => {
    let storedId = localStorage.getItem("pn_user_id");
    if (!storedId) { storedId = `user_${uuidv4()}`; localStorage.setItem("pn_user_id", storedId); }
    setUserId(storedId);
    void loadThreads(storedId);
    document.documentElement.classList.add('dark');

    return () => { if (wsRef.current) wsRef.current.close(); };
  }, []);

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
    if (isDarkMode) document.documentElement.classList.remove('dark');
    else document.documentElement.classList.add('dark');
  };

  const handleDeleteThread = async (tid: string, e: React.MouseEvent) => {
    e.stopPropagation(); 
    if (!confirm("정말 이 대화 기록을 삭제하시겠습니까?")) return;
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/threads/${tid}?user_id=${userId}`, { method: 'DELETE' });
      if (res.ok) {
        await loadThreads(userId);
        if (currentThreadId === tid) {
          setCurrentThreadId(""); setMessages([]); applyInputs(EMPTY_INPUTS); setIsFormExpanded(true);
        }
      } else alert("삭제에 실패했습니다.");
    } catch (err) { console.error("삭제 에러:", err); }
  };

  const applyInputs = (inputs?: Partial<ThreadInputs> | null) => {
    setCity(inputs?.selected_city || EMPTY_INPUTS.selected_city);
    setDistrict(inputs?.selected_district || EMPTY_INPUTS.selected_district);
    setDong(inputs?.selected_dong || EMPTY_INPUTS.selected_dong);
    setBirthYear(inputs?.birth_year || "");
    setExtraInfo(inputs?.extra_info || "");
  };

  const loadThreads = async (uid: string) => {
    try {
      setErrorMessage("");
      const threadList = await api.listThreads(uid);
      setThreads(threadList);
      if (threadList.length === 0) { await handleNewThread(uid); return; }
      const shouldKeepCurrent = threadList.some((thread) => thread.thread_id === currentThreadId);
      const targetThreadId = shouldKeepCurrent ? currentThreadId : threadList[0].thread_id;
      if (targetThreadId) await selectThread(uid, targetThreadId);
    } catch { setErrorMessage("서버와 연결할 수 없습니다."); }
  };

  const selectThread = async (uid: string, tid: string) => {
    try {
      setErrorMessage(""); setCurrentThreadId(tid); setMessages([]); setQuery(""); setIsSidebarOpen(false);
      const [loadedMessages, loadedInputs] = await Promise.all([ api.loadMessages(uid, tid), api.loadThreadInputs(uid, tid) ]);
      setMessages(loadedMessages); applyInputs(loadedInputs);
      if (loadedMessages.length > 0) setIsFormExpanded(false); else setIsFormExpanded(true);
    } catch (error) { setErrorMessage(extractApiErrorMessage(error)); }
  };

  const handleNewThread = async (uid = userId) => {
    try {
      setErrorMessage("");
      const newThreadId = await api.createThread(uid);
      setCurrentThreadId(newThreadId); setMessages([]); setQuery(""); applyInputs(EMPTY_INPUTS);
      setIsSidebarOpen(false); setIsFormExpanded(true); setThreads(await api.listThreads(uid));
    } catch { setErrorMessage("새 대화방을 만들 수 없습니다."); }
  };

  const validateStructuredSearch = () => {
    if (!city || city === DEFAULT_CITY) return "시/도를 선택해주세요.";
    if (!district || district === DEFAULT_CITY) return "시/군/구를 선택해주세요.";
    if (!/^\d{4}$/.test(birthYear)) return "출생연도는 4자리 숫자로 입력해주세요.";
    if (!extraInfo.trim()) return "추가 정보를 입력해주세요.";
    return "";
  };

  const handleSearch = async (isFollowUp = false) => {
    setErrorMessage(""); setAiStatus("");

    if (!userId) return setErrorMessage("사용자 정보가 준비되지 않았습니다. 새로고침 해주세요.");

    let targetThreadId = currentThreadId;
    if (!targetThreadId) {
      try { targetThreadId = await api.createThread(userId); setCurrentThreadId(targetThreadId); } 
      catch { return setErrorMessage("대화방을 만들 수 없습니다. 잠시 후 시도해 주세요."); }
    }

    if (isFollowUp) {
      if (!query.trim()) return setErrorMessage("추가 질문을 입력해주세요.");
      if (messages.length === 0) return setErrorMessage("먼저 기본 조건으로 혜택을 조회해주세요.");
    } else {
      const validationMessage = validateStructuredSearch();
      if (validationMessage) return setErrorMessage(validationMessage);
      setIsFormExpanded(false);
    }

    const followUpText = query.trim();
    const optimisticUserMessage = isFollowUp ? followUpText : `📍 ${city} ${district} ${dong !== DEFAULT_DONG ? dong : ""} | 🎂 ${birthYear}년생 | 📝 ${extraInfo}`;

    setLoading(true);
    setMessages((prev) => [...prev, { role: "user", content: optimisticUserMessage }, { role: "assistant", content: "" }]);
    if (isFollowUp) setQuery("");

    try {
      await api.saveThreadInputs(userId, targetThreadId, { selected_city: city, selected_district: district, selected_dong: dong, birth_year: birthYear, extra_info: extraInfo });

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId, thread_id: targetThreadId, city: isFollowUp ? undefined : city, district: isFollowUp ? undefined : district,
          dong: isFollowUp ? undefined : dong === DEFAULT_DONG ? "" : dong, birth_year: isFollowUp ? undefined : birthYear,
          extra_info: isFollowUp ? undefined : extraInfo, query: isFollowUp ? followUpText : undefined,
        }),
      });

      if (response.status === 403) {
        const errorData = await response.json();
        setErrorMessage(errorData.detail || "오늘의 검색 횟수를 모두 사용했습니다.");
        setMessages((prev) => prev.slice(0, -2)); setLoading(false); setIsFormExpanded(true); return;
      }
      if (!response.ok) throw new Error("서버 통신 오류");

      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "";
      const wsProtocol = baseUrl.startsWith("https") ? "wss" : "ws";
      const wsUrl = `${wsProtocol}://${baseUrl.replace(/^https?:\/\//, '')}/ws/chat/${targetThreadId}`;
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      let accumulatedContent = "";

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "content") {
            accumulatedContent += data.delta;
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { ...next[next.length - 1], content: accumulatedContent };
              return next;
            });
            setAiStatus(""); 
          } else if (data.type === "status") {
            setAiStatus(data.message);
          } else if (data.type === "done") {
            ws.close();
            setLoading(false);
            void api.listThreads(userId).then(setThreads);
          } else if (data.type === "error") {
            setErrorMessage(data.message);
            ws.close();
            setLoading(false);
          }
        } catch (e) { console.error("WS Parse Error", e); }
      };

      ws.onerror = () => {
        setErrorMessage("실시간 통신 연결에 문제가 발생했습니다.");
        setLoading(false);
      };

    } catch (error) {
      console.error(error);
      setMessages((prev) => prev.slice(0, -1));
      setErrorMessage("서버 상태가 불안정합니다. 잠시 후 다시 시도해 주세요.");
      setIsFormExpanded(true);
      setLoading(false);
    }
  };

  return (
    <div className="flex h-[100dvh] bg-gray-50 dark:bg-[#121212] text-gray-900 dark:text-gray-100 font-sans overflow-hidden transition-colors duration-300">
      {isSidebarOpen && <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden transition-opacity" onClick={() => setIsSidebarOpen(false)} />}

      <aside className={`fixed inset-y-0 left-0 z-50 w-72 flex flex-col bg-white dark:bg-[#1e1e1e] border-r border-gray-200 dark:border-[#333] transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-[#333] p-4">
          <h1 className="flex items-center gap-2 text-lg font-bold text-green-600 dark:text-green-400"><Search size={20} /> 정책 내비게이터</h1>
          <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-gray-500 hover:text-black dark:text-gray-400 dark:hover:text-white"><X size={24} /></button>
        </div>

        <div className="p-4">
          <button onClick={() => void handleNewThread()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-300 dark:border-[#444] bg-gray-100 dark:bg-[#2d2d2d] py-2.5 font-semibold text-gray-700 dark:text-gray-200 transition hover:bg-gray-200 dark:hover:bg-[#3d3d3d] active:scale-95">
            <Plus size={18} /> 새 대화 시작
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-3">
          <p className="mb-2 px-1 text-xs font-bold text-gray-500">대화 목록</p>
          {threads.map((thread) => (
            <button key={thread.thread_id} type="button" onClick={() => void selectThread(userId, thread.thread_id)} className={`group mb-1 flex w-full items-center justify-between rounded-xl p-3 text-left transition ${currentThreadId === thread.thread_id ? "border border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400" : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#2a2a2a]"}`}>
              <div className="flex min-w-0 items-center gap-2 truncate">
                <MessageSquare size={16} className="shrink-0" />
                <span className="truncate text-sm">{thread.title || "새 대화"}</span>
              </div>
              <Trash2 size={16} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity" onClick={(e) => handleDeleteThread(thread.thread_id, e)} />
            </button>
          ))}
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-[#333]">
          <button onClick={() => setShowDonation(true)} className="w-full flex items-center justify-center gap-2 py-3 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-bold rounded-xl transition-colors shadow-sm">
            <Coffee size={18} /> 서버 운영 후원하기
          </button>
        </div>
      </aside>

      <main className="relative flex h-full flex-1 flex-col w-full">
        <div className="absolute top-4 right-4 z-50 hidden md:block">
          <button onClick={toggleTheme} className="p-2.5 rounded-full bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#444] text-gray-600 dark:text-gray-300 shadow-sm hover:scale-105 transition-transform">
            {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>

        <div className="flex items-center justify-between bg-white dark:bg-[#1a1a1a] p-4 border-b border-gray-200 dark:border-[#333] md:hidden shrink-0">
          <div className="font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>맞춤 혜택 찾기</div>
          <div className="flex gap-3">
            <button onClick={toggleTheme} className="text-gray-500 dark:text-gray-300"><Sun size={24} className="block dark:hidden"/><Moon size={24} className="hidden dark:block"/></button>
            <button onClick={() => setIsSidebarOpen(true)} className="text-gray-500 dark:text-gray-300"><Menu size={24} /></button>
          </div>
        </div>

        <div className="shrink-0 bg-white dark:bg-[#1a1a1a] relative border-b border-gray-200 dark:border-[#333] md:pt-16 z-20">
          <div className={`mx-auto max-w-4xl px-4 transition-all duration-300 ease-in-out origin-top ${isFormExpanded ? 'max-h-[500px] py-4 opacity-100' : 'max-h-0 py-0 opacity-0 overflow-hidden'}`}>
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <select className="w-full rounded-lg border border-gray-300 dark:border-[#444] bg-white dark:bg-[#2a2a2a] p-3 text-sm text-gray-800 dark:text-gray-100 outline-none transition focus:border-green-500" value={city} onChange={(e) => { setCity(e.target.value); setDistrict(DEFAULT_CITY); setDong(DEFAULT_DONG); }}><option>{DEFAULT_CITY}</option>{Object.keys(CITY_TO_DISTRICTS).map((c) => <option key={c}>{c}</option>)}</select>
                <select className="w-full rounded-lg border border-gray-300 dark:border-[#444] bg-white dark:bg-[#2a2a2a] p-3 text-sm text-gray-800 dark:text-gray-100 outline-none transition focus:border-green-500" value={district} onChange={(e) => { setDistrict(e.target.value); setDong(DEFAULT_DONG); }} disabled={city === DEFAULT_CITY}><option>{DEFAULT_CITY}</option>{availableDistricts.map((d) => <option key={d}>{d}</option>)}</select>
                <select className="w-full rounded-lg border border-gray-300 dark:border-[#444] bg-white dark:bg-[#2a2a2a] p-3 text-sm text-gray-800 dark:text-gray-100 outline-none transition focus:border-green-500" value={dong} onChange={(e) => setDong(e.target.value)} disabled={district === DEFAULT_CITY}><option>{DEFAULT_DONG}</option>{availableDongs.map((d) => <option key={d}>{d}</option>)}</select>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input type="tel" placeholder="출생연도 (예: 1999)" maxLength={4} className="w-full rounded-lg border border-gray-300 dark:border-[#444] bg-white dark:bg-[#2a2a2a] p-3 text-sm text-gray-800 dark:text-gray-100 outline-none transition focus:border-green-500 sm:w-1/3" value={birthYear} onChange={(e) => setBirthYear(e.target.value.replace(/[^0-9]/g, ""))} />
                <input type="text" placeholder="추가 정보 (예: 현재 직업, 주거 형태, 월 소득 등)" className="w-full rounded-lg border border-gray-300 dark:border-[#444] bg-white dark:bg-[#2a2a2a] p-3 text-sm text-gray-800 dark:text-gray-100 outline-none transition focus:border-green-500 sm:w-2/3" value={extraInfo} onChange={(e) => setExtraInfo(e.target.value)} />
              </div>
              <button onClick={() => void handleSearch(false)} disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 py-3.5 sm:py-3 font-bold text-white transition hover:bg-green-500 disabled:opacity-50 active:scale-[0.98] shadow-md">
                {loading ? <Loader2 className="animate-spin" /> : <Search size={20} />} 맞춤 혜택 찾기
              </button>
              {errorMessage && (
                <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-100 dark:bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-200">
                  <AlertCircle size={18} className="mt-0.5 shrink-0" /><span>{errorMessage}</span>
                </div>
              )}
            </div>
          </div>
          <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 z-30">
            <button onClick={() => setIsFormExpanded(!isFormExpanded)} className="bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#444] rounded-full p-1.5 text-gray-500 hover:text-green-600 dark:hover:text-green-400 shadow-md transition-transform hover:scale-105">
              {isFormExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-y-auto p-4 sm:p-8 scroll-smooth z-10">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-gray-400 dark:text-gray-500 text-center px-4">
              <MapPin size={48} className="mb-4 opacity-20" />
              <p className="text-sm sm:text-base">거주지와 정보를 입력하고<br className="sm:hidden" /> 당신만의 혜택을 찾아보세요.</p>
            </div>
          ) : (
            <div className="space-y-6 pb-4">
              {messages.map((message, index) => {
                const isLastMessage = index === messages.length - 1;
                const isAssistant = message.role === "assistant";

                return (
                  <div key={`${message.role}-${index}`} className={`flex gap-3 sm:gap-4 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                    {isAssistant && (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-600 mt-1 shadow-sm"><span className="text-[10px] sm:text-xs font-bold text-white">AI</span></div>
                    )}
                    <div className={`max-w-[90%] sm:max-w-[85%] rounded-2xl p-4 shadow-sm overflow-hidden ${message.role === "user" ? "whitespace-pre-wrap border border-gray-200 dark:border-[#444] bg-white dark:bg-[#2d2d2d] text-gray-800 dark:text-gray-200 text-sm sm:text-base" : "bg-transparent text-gray-800 dark:text-gray-300"}`}>
                      
                      {isAssistant ? <MarkdownMessage content={message.content} /> : <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>}
                      
                      {isLastMessage && isAssistant && loading && (
                        <div className="mt-4 flex items-center gap-2 text-sm font-bold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-4 py-2.5 rounded-xl w-fit animate-pulse border border-green-200 dark:border-green-800/30 shadow-sm">
                          <Loader2 size={16} className="animate-spin shrink-0" />
                          <span>{aiStatus || "정책 데이터를 열심히 분석하고 있습니다..."}</span>
                        </div>
                      )}

                      {!loading && isAssistant && message.content.length > 50 && (
                        <div className="mt-4 pt-3 border-t border-gray-200 dark:border-[#444] flex justify-end animate-in fade-in duration-300">
                          <button onClick={async () => {
                              const shareData = { title: '나에게 딱 맞는 맞춤형 정부 혜택 🎁', text: '정책 내비게이터가 찾아준 맞춤형 혜택을 확인해보세요!\n\n' + message.content.substring(0, 100) + '...', url: window.location.href };
                              try { 
                                if (typeof navigator.share === 'function') { 
                                  await navigator.share(shareData); 
                                } else { 
                                  await navigator.clipboard.writeText(shareData.text + '\n' + shareData.url); 
                                  alert('결과가 클립보드에 복사되었습니다! 친구에게 붙여넣기 해보세요.'); 
                                } 
                              } catch (err) { console.error('공유 실패:', err); }
                            }} className="text-xs font-bold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-3 py-1.5 rounded-lg hover:bg-green-200 dark:hover:bg-green-800/50 transition-colors flex items-center gap-1">🔗 결과 공유하기</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-gray-200 dark:border-[#333] bg-gray-50 dark:bg-[#121212] p-3 sm:p-4 pb-safe transition-colors duration-300 z-20">
          <div className="relative mx-auto max-w-4xl flex flex-col">
            <div className="flex gap-2 mb-3 overflow-x-auto pb-1 scrollbar-hide">
              {["🧑‍🎓 대학생을 위한 월세 지원 정책 찾아줘", "💼 취업 준비생 국비 지원 교육 알려줘", "💰 20대 청년 적금 혜택 정리해 줘"].map((example, idx) => (
                <button key={idx} onClick={() => setQuery(example)} className="whitespace-nowrap px-4 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600 transition-colors shadow-sm">{example}</button>
              ))}
            </div>
            <div className="relative">
              <input type="text" placeholder="추가 질문을 입력하세요 (예: 청년 혜택만 다시)" className="w-full rounded-full border border-gray-300 dark:border-[#444] bg-white dark:bg-[#1e1e1e] py-3.5 pl-5 pr-12 text-sm text-gray-800 dark:text-white outline-none transition focus:border-green-500 shadow-sm" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void handleSearch(true); }} disabled={messages.length === 0 || loading} />
              <button onClick={() => void handleSearch(true)} disabled={!query.trim() || loading} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-green-600 p-2 text-white transition hover:bg-green-500 disabled:opacity-50"><Send size={16} /></button>
            </div>
          </div>
        </div>
      </main>

      {showDonation && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] px-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#1e1e1e] p-6 rounded-2xl shadow-xl w-full max-w-sm text-center relative border border-gray-200 dark:border-[#333]">
            <button onClick={() => setShowDonation(false)} className="absolute top-3 right-3 p-1 rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"><X size={20} /></button>
            <div className="w-16 h-16 bg-yellow-100 dark:bg-yellow-900/30 rounded-full flex items-center justify-center mx-auto mb-4"><Coffee size={32} className="text-yellow-600 dark:text-yellow-500" /></div>
            <h2 className="text-xl font-bold mb-2 text-gray-800 dark:text-gray-100">서버 운영에 힘 보태기</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6 leading-relaxed">여러분에게 유용한 혜택을 찾아주기 위한<br/>AI API 통신비와 서버 유지비로 사용됩니다.<br/>작은 후원도 큰 힘이 됩니다! 🙇‍♂️</p>
            <div className="bg-gray-50 dark:bg-[#121212] border border-gray-200 dark:border-[#333] p-4 rounded-xl text-left text-sm font-medium text-gray-700 dark:text-gray-300 mb-6 space-y-1">
              <p className="flex justify-between"><span>은행</span> <span className="font-bold">케이뱅크</span></p>
              <p className="flex justify-between"><span>계좌번호</span> <span className="font-bold">100238386987</span></p>
              <p className="flex justify-between"><span>예금주</span> <span className="font-bold">유창현</span></p>
            </div>
            <button onClick={() => { navigator.clipboard.writeText("100238386987"); alert("계좌번호가 복사되었습니다!"); }} className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-colors active:scale-95 shadow-sm">📋 계좌번호 복사하기</button>
          </div>
        </div>
      )}
    </div>
  );
}
