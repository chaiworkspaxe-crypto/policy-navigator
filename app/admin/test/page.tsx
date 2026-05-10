// app/admin/test/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { api, ChatMessage, extractApiErrorMessage, ThreadInputs, ThreadItem } from "@/lib/api";
import { CITY_TO_DISTRICTS, DONG_MAP } from "@/lib/regionData";
import MarkdownMessage from "@/components/MarkdownMessage";
import { MessageSquare, Plus, Send, Loader2, MapPin, Search, AlertCircle, Menu, X, Trash2, Sun, Moon, Coffee, ChevronUp, ChevronDown, RefreshCw } from "lucide-react";

const DEFAULT_CITY = "선택하세요";
const DEFAULT_DONG = "선택 안 함";
const EMPTY_INPUTS: ThreadInputs = { selected_city: DEFAULT_CITY, selected_district: DEFAULT_CITY, selected_dong: DEFAULT_DONG, birth_year: "", extra_info: "" };

const extractSummaryTableText = (text: string) => {
  const lines = text.split('\n');
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue; 
    const normalized = line.replace(/ /g, "");
    if (normalized.includes("|분야|") && normalized.includes("|정책명|") && (normalized.includes("|신청마감일|") || normalized.includes("|핵심혜택|"))) {
      headerIdx = i; break;
    }
  }
  if (headerIdx === -1) return "";
  
  const headerLine = lines[headerIdx];
  if (headerLine === undefined) return ""; 

  const tableLines = [headerLine];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue; 
    
    const trimmedLine = line.trim();
    if (!trimmedLine) { if (tableLines.length >= 2) break; continue; }
    if (!trimmedLine.includes('|')) { if (tableLines.length >= 2) break; continue; }
    tableLines.push(line);
  }
  return tableLines.join('\n');
};

const hasSummaryTable = (text: string) => {
  return extractSummaryTableText(text).length > 0;
};

export default function AdminTestPage() {
  const ADMIN_ID = "8011";
  
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [userId, setUserId] = useState(ADMIN_ID);
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

  const availableDistricts = useMemo(() => CITY_TO_DISTRICTS[city] || [], [city]);
  const availableDongs = useMemo(() => DONG_MAP[`${city}-${district}`] || [], [city, district]);

  useEffect(() => {
    const password = window.prompt("관리자 비밀번호를 입력하세요.");
    
    if (password === "8011") {
      setIsAdminAuthenticated(true);
      setUserId(ADMIN_ID);
      void loadThreads(ADMIN_ID);
      document.documentElement.classList.add('dark');
    } else {
      alert("비밀번호가 틀렸습니다. 메인 페이지로 이동합니다.");
      window.location.href = "/";
    }
  }, []);

  // 🌟 [수정 포인트 1] 화면을 껐다 켰을 때(visibilitychange) 호출되는 부분도 객체 배열 타입에 대응
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && currentThreadId && userId) {
        api.loadMessages(userId, currentThreadId)
          .then((res: any) => {
            const msgs = Array.isArray(res) ? res : res.messages || [];
            if (msgs.length > 0) setMessages(msgs);
          })
          .catch(console.error);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [currentThreadId, userId]);

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
      
      const targetThreadId = shouldKeepCurrent ? currentThreadId : threadList[0]?.thread_id;
      
      if (targetThreadId) await selectThread(uid, targetThreadId);
    } catch { setErrorMessage("서버와 연결할 수 없습니다."); }
  };

  // 🌟 [수정 포인트 2] 빌드 에러의 주범! selectThread 부분 타입 대응 완료
  const selectThread = async (uid: string, tid: string) => {
    try {
      setErrorMessage(""); setCurrentThreadId(tid); setMessages([]); setQuery(""); setIsSidebarOpen(false);
      
      const [loadedData, loadedInputs] = await Promise.all([ api.loadMessages(uid, tid), api.loadThreadInputs(uid, tid) ]);
      
      // API 반환 타입 변경에 대응 (배열인지 객체인지 판별하여 메시지만 추출)
      const msgs = Array.isArray(loadedData) ? loadedData : (loadedData as any).messages || [];
      
      setMessages(msgs); 
      applyInputs(loadedInputs);
      
      if (msgs.length > 0) setIsFormExpanded(false); else setIsFormExpanded(true);
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

  const handleSearch = async (isFollowUp = false, overridePrompt?: string) => {
    setErrorMessage(""); setAiStatus("");

    let targetThreadId = currentThreadId;
    if (!targetThreadId) {
      try { targetThreadId = await api.createThread(userId); setCurrentThreadId(targetThreadId); } 
      catch { return setErrorMessage("대화방을 만들 수 없습니다. 잠시 후 시도해 주세요."); }
    }

    if (isFollowUp && !overridePrompt) {
      if (!query.trim()) return setErrorMessage("추가 질문을 입력해주세요.");
      if (messages.length === 0) return setErrorMessage("먼저 기본 조건으로 혜택을 조회해주세요.");
    } else if (!isFollowUp) {
      const validationMessage = validateStructuredSearch();
      if (validationMessage) return setErrorMessage(validationMessage);
      setIsFormExpanded(false);
    }

    const followUpText = overridePrompt || query.trim();
    const optimisticUserMessage = isFollowUp ? followUpText : `📍 ${city} ${district} ${dong !== DEFAULT_DONG ? dong : ""} | 🎂 ${birthYear}년생 | 📝 ${extraInfo}`;

    setLoading(true);
    setMessages((prev) => [...prev, { role: "user", content: optimisticUserMessage }, { role: "assistant", content: "" }]);
    if (isFollowUp && !overridePrompt) setQuery("");

    try {
      await api.saveThreadInputs(userId, targetThreadId, { selected_city: city, selected_district: district, selected_dong: dong, birth_year: birthYear, extra_info: extraInfo });

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/chat/stream`, {
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

      const reader = response.body?.getReader();
      const decoder = new TextDecoder("utf-8");
      let accumulatedContent = "";
      let buffer = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ""; 

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const dataStr = line.substring(6).trim();
              if (!dataStr) continue;

              try {
                const data = JSON.parse(dataStr);
                if (data.type === "content") {
                  accumulatedContent += data.delta;
                  setMessages((prev) => {
                    const next = [...prev];
                    const lastMsg = next[next.length - 1];
                    if (lastMsg) {
                      next[next.length - 1] = { 
                        ...lastMsg, 
                        role: "assistant", 
                        content: accumulatedContent 
                      };
                    }
                    return next;
                  });
                  setAiStatus(""); 
                } else if (data.type === "status") {
                  setAiStatus(data.message);
                }
              } catch (e) {
                // Ignore parse errors (padding/chunks)
              }
            }
          }
        }
      }

      setLoading(false);
      void api.listThreads(userId).then(setThreads);

    } catch (error) {
      console.error(error);
      setMessages((prev) => prev.slice(0, -1));
      setErrorMessage("서버 상태가 불안정합니다. 잠시 후 다시 시도해 주세요.");
      setIsFormExpanded(true);
      setLoading(false);
    }
  };

  if (!isAdminAuthenticated) {
    return null; 
  }

  return (
    <div className="flex h-[100dvh] bg-gray-50 dark:bg-[#121212] text-gray-900 dark:text-gray-100 font-sans overflow-hidden transition-colors duration-300">
      {isSidebarOpen && <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden transition-opacity" onClick={() => setIsSidebarOpen(false)} />}

      <aside className={`fixed inset-y-0 left-0 z-50 w-72 flex flex-col bg-white dark:bg-[#1e1e1e] border-r border-gray-200 dark:border-[#333] transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-[#333] p-4">
          <h1 className="flex items-center gap-2 text-lg font-bold text-red-600 dark:text-red-500"><Search size={20} /> 관리자 테스트 모드</h1>
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
            <button key={thread.thread_id} type="button" onClick={() => void selectThread(userId, thread.thread_id)} className={`group mb-1 flex w-full items-center justify-between rounded-xl p-3 text-left transition ${currentThreadId === thread.thread_id ? "border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400" : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#2a2a2a]"}`}>
              <div className="flex min-w-0 items-center gap-2 truncate">
                <MessageSquare size={16} className="shrink-0" />
                <span className="truncate text-sm">{thread.title || "새 대화"}</span>
              </div>
              <Trash2 size={16} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity" onClick={(e) => handleDeleteThread(thread.thread_id, e)} />
            </button>
          ))}
        </div>
      </aside>

      <main className="relative flex h-full flex-1 flex-col w-full">
        <div className="bg-red-600 text-white text-center py-1.5 text-xs sm:text-sm font-bold tracking-wider z-50 shadow-md">
          ⚠️ 관리자 무제한 테스트 모드 활성화 (ID: 8011) ⚠️
        </div>

        <div className="absolute top-[3.5rem] right-4 z-50 hidden md:block">
          <button onClick={toggleTheme} className="p-2.5 rounded-full bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#444] text-gray-600 dark:text-gray-300 shadow-sm hover:scale-105 transition-transform">
            {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>

        <div className="flex items-center justify-between bg-white dark:bg-[#1a1a1a] p-4 border-b border-gray-200 dark:border-[#333] md:hidden shrink-0">
          <div className="font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>관리자 맞춤 혜택 찾기</div>
          <div className="flex gap-3">
            <button onClick={toggleTheme} className="text-gray-500 dark:text-gray-300"><Sun size={24} className="block dark:hidden"/><Moon size={24} className="hidden dark:block"/></button>
            <button onClick={() => setIsSidebarOpen(true)} className="text-gray-500 dark:text-gray-300"><Menu size={24} /></button>
          </div>
        </div>

        <div className="shrink-0 bg-white dark:bg-[#1a1a1a] relative border-b border-gray-200 dark:border-[#333] md:pt-16 z-20">
          <div className={`mx-auto max-w-4xl px-4 transition-all duration-300 ease-in-out origin-top ${isFormExpanded ? 'max-h-[500px] py-4 opacity-100' : 'max-h-0 py-0 opacity-0 overflow-hidden'}`}>
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <select className="w-full rounded-lg border border-gray-300 dark:border-[#444] bg-white dark:bg-[#2a2a2a] p-3 text-sm text-gray-800 dark:text-gray-100 outline-none transition focus:border-red-500" value={city} onChange={(e) => { setCity(e.target.value); setDistrict(DEFAULT_CITY); setDong(DEFAULT_DONG); }}><option>{DEFAULT_CITY}</option>{Object.keys(CITY_TO_DISTRICTS).map((c) => <option key={c}>{c}</option>)}</select>
                <select className="w-full rounded-lg border border-gray-300 dark:border-[#444] bg-white dark:bg-[#2a2a2a] p-3 text-sm text-gray-800 dark:text-gray-100 outline-none transition focus:border-red-500" value={district} onChange={(e) => { setDistrict(e.target.value); setDong(DEFAULT_DONG); }} disabled={city === DEFAULT_CITY}><option>{DEFAULT_CITY}</option>{availableDistricts.map((d) => <option key={d}>{d}</option>)}</select>
                <select className="w-full rounded-lg border border-gray-300 dark:border-[#444] bg-white dark:bg-[#2a2a2a] p-3 text-sm text-gray-800 dark:text-gray-100 outline-none transition focus:border-red-500" value={dong} onChange={(e) => setDong(e.target.value)} disabled={district === DEFAULT_CITY}><option>{DEFAULT_DONG}</option>{availableDongs.map((d) => <option key={d}>{d}</option>)}</select>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input type="tel" placeholder="출생연도 (예: 1999)" maxLength={4} className="w-full rounded-lg border border-gray-300 dark:border-[#444] bg-white dark:bg-[#2a2a2a] p-3 text-sm text-gray-800 dark:text-gray-100 outline-none transition focus:border-red-500 sm:w-1/3" value={birthYear} onChange={(e) => setBirthYear(e.target.value.replace(/[^0-9]/g, ""))} />
                <input type="text" placeholder="추가 정보 (예: 현재 직업, 주거 형태(자취 월세방, 부모님과 거주), 월 소득)" className="w-full rounded-lg border border-gray-300 dark:border-[#444] bg-white dark:bg-[#2a2a2a] p-3 text-sm text-gray-800 dark:text-gray-100 outline-none transition focus:border-red-500 sm:w-2/3" value={extraInfo} onChange={(e) => setExtraInfo(e.target.value)} />
              </div>
              <button onClick={() => void handleSearch(false)} disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 py-3.5 sm:py-3 font-bold text-white transition hover:bg-red-500 disabled:opacity-50 active:scale-[0.98] shadow-md">
                {loading ? <Loader2 className="animate-spin" /> : <Search size={20} />} (관리자) 맞춤 혜택 찾기
              </button>
              {errorMessage && (
                <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-100 dark:bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-200">
                  <AlertCircle size={18} className="mt-0.5 shrink-0" /><span>{errorMessage}</span>
                </div>
              )}
            </div>
          </div>
          <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 z-30">
            <button onClick={() => setIsFormExpanded(!isFormExpanded)} className="bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#444] rounded-full p-1.5 text-gray-500 hover:text-red-600 dark:hover:text-red-400 shadow-md transition-transform hover:scale-105">
              {isFormExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-y-auto p-4 sm:p-8 scroll-smooth z-10">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-gray-400 dark:text-gray-500 text-center px-4">
              <MapPin size={48} className="mb-4 opacity-20 text-red-500" />
              <p className="text-sm sm:text-base">관리자 권한으로 로그인되었습니다.<br className="sm:hidden" /> 횟수 제한 없이 테스트하세요.</p>
            </div>
          ) : (
            <div className="space-y-6 pb-4">
              {messages.map((message, index) => {
                const isLastMessage = index === messages.length - 1;
                const isAssistant = message.role === "assistant";

                return (
                  <div key={`${message.role}-${index}`} className={`flex gap-3 sm:gap-4 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                    {isAssistant && (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-600 mt-1 shadow-sm"><span className="text-[10px] sm:text-xs font-bold text-white">AI</span></div>
                    )}
                    <div className={`max-w-[90%] sm:max-w-[85%] rounded-2xl p-4 shadow-sm overflow-hidden ${message.role === "user" ? "whitespace-pre-wrap border border-gray-200 dark:border-[#444] bg-white dark:bg-[#2d2d2d] text-gray-800 dark:text-gray-200 text-sm sm:text-base" : "bg-transparent text-gray-800 dark:text-gray-300"}`}>
                      {isAssistant ? <MarkdownMessage content={message.content} /> : <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>}
                      
                      {isAssistant && message.content.length > 50 && (
                        <div className="mt-4 pt-3 border-t border-gray-200 dark:border-[#444] flex justify-end">
                          <button onClick={async () => {
                              const shareData = { 
                                title: '나에게 딱 맞는 맞춤형 정부 혜택 🎁', 
                                text: '정책 내비게이터가 찾아준 맞춤형 혜택을 확인해보세요!\n\n' + message.content + '\n\n', 
                                url: window.location.href 
                              };
                              try { 
                                const isMobile = /Mobi|Android/i.test(navigator.userAgent);
                                
                                if (isMobile && navigator.share) { 
                                  await navigator.share(shareData); 
                                } else { 
                                  await navigator.clipboard.writeText(shareData.text + shareData.url); 
                                  alert('전체 결과가 클립보드에 복사되었습니다! 메모장이나 카톡 PC버전에 붙여넣기 해보세요.'); 
                                } 
                              } catch (err) { 
                                console.error('공유/복사 실패:', err); 
                              }
                            }} className="text-xs font-bold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-3 py-1.5 rounded-lg hover:bg-green-200 dark:hover:bg-green-800/50 transition-colors flex items-center gap-1">🔗 결과 공유하기</button>
                        </div>
                      )}

                      {!loading && isLastMessage && isAssistant && message.content.length > 50 && !hasSummaryTable(message.content) && (
                         <div className="mt-4 p-4 bg-gray-50 dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-[#444] animate-in fade-in duration-300">
                           <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                             <AlertCircle size={16} className="text-yellow-500" />
                             답변이 중간에 끊긴 것 같나요? 아래 버튼을 눌러 마저 들을 수 있어요!
                           </p>
                           <button
                             onClick={() => {
                               setQuery(""); 
                               void handleSearch(true, "답변이 끊겼어. 방금 하던 말부터 이어서 계속해줘.");
                             }}
                             className="w-full flex items-center justify-center gap-2 py-2.5 bg-white dark:bg-[#2d2d2d] border border-gray-300 dark:border-[#555] rounded-lg hover:bg-gray-100 dark:hover:bg-[#3d3d3d] transition-colors text-sm font-bold text-gray-700 dark:text-gray-200 shadow-sm"
                           >
                             <RefreshCw size={16} /> 답변 이어서 생성하기
                           </button>
                         </div>
                      )}

                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {loading && messages[messages.length - 1]?.content === "" && (
            <div className="mt-4 flex justify-start gap-3 sm:gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-600 shadow-sm"><Loader2 size={16} className="animate-spin text-white" /></div>
              <div className="p-3 text-sm text-gray-500 dark:text-gray-400 font-medium">{aiStatus || "좌뇌론 글 쓰고 우뇌론 검색 중! 🧠💥 멀티태스킹에 AI CPU가 울고 있으니 타자가 살짝 버벅여도 봐주세요 🥺💦"}</div>
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
              <input type="text" placeholder="추가 질문을 입력하세요 (예: 청년 혜택만 다시)" className="w-full rounded-full border border-gray-300 dark:border-[#444] bg-white dark:bg-[#1e1e1e] py-3.5 pl-5 pr-12 text-sm text-gray-800 dark:text-white outline-none transition focus:border-red-500 shadow-sm" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void handleSearch(true); }} disabled={messages.length === 0 || loading} />
              <button onClick={() => void handleSearch(true)} disabled={!query.trim() || loading} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-red-600 p-2 text-white transition hover:bg-red-500 disabled:opacity-50"><Send size={16} /></button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
