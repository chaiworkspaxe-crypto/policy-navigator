"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { api, ChatMessage, extractApiErrorMessage, ThreadInputs, ThreadItem } from "@/lib/api";
import { CITY_TO_DISTRICTS, DONG_MAP } from "@/lib/regionData";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw'; 
import { 
  MessageSquare, Plus, Send, Loader2, MapPin, Search, AlertCircle, 
  Menu, X, Trash2, Sun, Moon, Coffee, ChevronUp, ChevronDown, 
  Download, RefreshCw, FileText, Image as ImageIcon
} from "lucide-react";

const DEFAULT_CITY = "선택하세요";
const DEFAULT_DONG = "선택 안 함";
const EMPTY_INPUTS: ThreadInputs = { selected_city: DEFAULT_CITY, selected_district: DEFAULT_CITY, selected_dong: DEFAULT_DONG, birth_year: "", extra_info: "" };

// 🌟 [진짜 원인 해결!] AI가 단어를 '분류', '마감일' 등으로 맘대로 바꿔도 표를 인식할 수 있도록 대폭 개선!
const extractSummaryTableText = (text: string) => {
  const lines = text.split('\n');
  let headerIdx = -1;
  
  for (let i = 0; i < lines.length; i++) {
    // 마크다운 표의 기본 구조인 '|' 문자가 있고, 정책과 관련된 핵심 단어가 하나라도 있으면 표의 시작으로 인정!
    if (lines[i].includes('|') && (lines[i].includes('정책') || lines[i].includes('마감') || lines[i].includes('혜택') || lines[i].includes('분야') || lines[i].includes('분류'))) {
      headerIdx = i;
      break;
    }
  }
  
  // 혹시라도 단어가 아예 다르면, 마크다운 표 구분선(|---| 또는 |:---|) 자체를 찾아서 표로 인식시킴!
  if (headerIdx === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('|') && i + 1 < lines.length && lines[i+1].match(/\|[-:]/)) {
        headerIdx = i;
        break;
      }
    }
  }

  if (headerIdx === -1) return "";
  
  const tableLines = [lines[headerIdx]];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) { if (tableLines.length >= 2) break; continue; }
    if (!line.includes('|')) { if (tableLines.length >= 2) break; continue; }
    tableLines.push(lines[i]);
  }
  return tableLines.join('\n');
};

const hasSummaryTable = (text: string) => {
  return extractSummaryTableText(text).length > 0;
};

const downloadTextFile = (content: string, filename: string) => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const downloadAsImage = async (elementId: string, filename: string) => {
  const element = document.getElementById(elementId);
  if (!element) {
    alert("캡처할 영역을 찾을 수 없습니다.");
    return;
  }

  try {
    const htmlToImage = await import("html-to-image");
    const isDark = document.documentElement.classList.contains('dark');
    const bgColor = isDark ? '#2d2d2d' : '#ffffff';
    
    const dataUrl = await htmlToImage.toJpeg(element, {
      quality: 0.95,
      backgroundColor: bgColor, 
      pixelRatio: 2,
    });

    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    link.click();
  } catch (error: any) {
    console.error("이미지 캡처 실패:", error);
    alert(`이미지 저장 중 오류가 발생했습니다: ${error?.message || '알 수 없는 에러'}`);
  }
};

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
  const [showManual, setShowManual] = useState(false);

  // 🌟 [핵심 방어선] 롤백되어도 절대 지워지지 않는 독립적인 '버튼 숨김' 상태 (유지)
  const [hideFollowUpButton, setHideFollowUpButton] = useState(false);

  const [isConfirmingDeleteAll, setIsConfirmingDeleteAll] = useState(false);
  const deleteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [city, setCity] = useState(EMPTY_INPUTS.selected_city);
  const [district, setDistrict] = useState(EMPTY_INPUTS.selected_district);
  const [dong, setDong] = useState(EMPTY_INPUTS.selected_dong);
  const [birthYear, setBirthYear] = useState(EMPTY_INPUTS.birth_year);
  const [extraInfo, setExtraInfo] = useState(EMPTY_INPUTS.extra_info);
  const [query, setQuery] = useState("");

  const availableDistricts = useMemo(() => CITY_TO_DISTRICTS[city] || [], [city]);
  const availableDongs = useMemo(() => DONG_MAP[`${city}-${district}`] || [], [city, district]);

  useEffect(() => {
    let storedId = localStorage.getItem("pn_user_id");
    if (!storedId) { storedId = `user_${uuidv4()}`; localStorage.setItem("pn_user_id", storedId); }
    setUserId(storedId);
    void loadThreads(storedId);
    document.documentElement.classList.add('dark');
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && currentThreadId && userId && !loading) {
        api.loadMessages(userId, currentThreadId)
          .then((reloadedMessages) => {
            if (reloadedMessages.length > 0) setMessages(reloadedMessages);
          })
          .catch(console.error);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [currentThreadId, userId, loading]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, aiStatus]);

  useEffect(() => {
    if (messages.length > 0) {
      import("html-to-image");
    }
  }, [messages.length]);

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
    if (isDarkMode) document.documentElement.classList.remove('dark');
    else document.documentElement.classList.add('dark');
  };

  const handleDeleteThread = async (tid: string, e: React.MouseEvent) => {
    e.stopPropagation(); 
    if (!confirm("정말 이 대화 기록을 삭제하시겠습니까?")) return;
    try {
      await api.deleteThread(userId, tid);
      await loadThreads(userId);
      if (currentThreadId === tid) {
        setCurrentThreadId(""); 
        setMessages([]); 
        applyInputs(EMPTY_INPUTS); 
        setIsFormExpanded(true);
      }
    } catch (err) { 
      console.error("삭제 에러:", err);
      alert("삭제에 실패했습니다.");
    }
  };

  const handleDeleteAll = async () => {
    if (!isConfirmingDeleteAll) {
      setIsConfirmingDeleteAll(true);
      deleteTimeoutRef.current = setTimeout(() => {
        setIsConfirmingDeleteAll(false);
      }, 3000);
    } else {
      if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current);
      try {
        await api.deleteAllThreads(userId);
        alert("그동안의 혜택 탐색 기록이 깔끔하게 지워졌습니다! ✨");
        window.location.reload();
      } catch (error) {
        console.error(error);
        alert("삭제 중 오류가 발생했습니다. 다시 시도해주세요.");
      } finally {
        setIsConfirmingDeleteAll(false);
      }
    }
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
      setErrorMessage(""); setCurrentThreadId(tid); setMessages([]); setQuery(""); setIsSidebarOpen(false); setHideFollowUpButton(false);
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
      setHideFollowUpButton(false);
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

    if (overridePrompt) {
      setHideFollowUpButton(true); 
    } else {
      setHideFollowUpButton(false);
    }

    if (!userId) return setErrorMessage("사용자 정보가 준비되지 않았습니다. 새로고침 해주세요.");

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

    const originalMessages = [...messages]; 
    const newMessages = [...messages, { role: "user" as const, content: optimisticUserMessage }];

    setLoading(true);
    setMessages([...newMessages, { role: "assistant" as const, content: "" }]);
    if (isFollowUp && !overridePrompt) setQuery("");

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 90000); 

    try {
      await api.saveThreadInputs(userId, targetThreadId, { selected_city: city, selected_district: district, selected_dong: dong, birth_year: birthYear, extra_info: extraInfo });

      const response = await fetch(`/api/chat`, {
        method: 'POST', 
        signal: abortController.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          userId: userId,           
          threadId: targetThreadId  
        }),
      });

      clearTimeout(timeoutId);

      if (response.status === 403) {
        const errorData = await response.json();
        setErrorMessage(errorData.detail || "오늘의 검색 횟수를 모두 사용했습니다.");
        setMessages(originalMessages); 
        setLoading(false); 
        setIsFormExpanded(true); 
        return;
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
            const dataStr = line.replace(/^data:\s*/, '').trim(); 
            if (!dataStr) continue;

            try {
              const data = JSON.parse(dataStr);
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
              }
            } catch (e) {
              // chunk 무시
            }
          }
        }
      }

      if (!accumulatedContent.trim()) {
        throw new Error("EMPTY_AI_RESPONSE");
      }

      setLoading(false);
      void api.listThreads(userId).then(setThreads);

    } catch (error: any) {
      clearTimeout(timeoutId);
      console.error(error);
      
      setMessages(originalMessages); 
      
      if (error.name === 'AbortError') {
        setErrorMessage("응답이 너무 오래 걸려 중단되었습니다. 잠시 후 다시 시도해주세요. ⏳");
      } else if (error.message === 'EMPTY_AI_RESPONSE') {
        setErrorMessage("AI가 정보를 찾지 못했습니다. 잠시 후 다시 시도해주세요. 😭");
      } else {
        setErrorMessage("서버 상태가 불안정합니다. 잠시 후 다시 시도해 주세요.");
      }
      
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

        <div className="p-4 border-t border-gray-200 dark:border-[#333] flex flex-col gap-2">
          <button 
            onClick={handleDeleteAll} 
            className={`w-full flex items-center justify-center gap-2 py-3 font-bold rounded-xl transition-colors shadow-sm ${
              isConfirmingDeleteAll 
                ? 'bg-red-500 hover:bg-red-600 text-white' 
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-[#2d2d2d] dark:hover:bg-[#3d3d3d] dark:text-gray-300'
            }`}
          >
            {isConfirmingDeleteAll ? (
              <>🚨 찐으로 전체 삭제 (클릭)</>
            ) : (
              <><Trash2 size={18} /> 전체 대화 삭제</>
            )}
          </button>
          
          <button onClick={() => setShowDonation(true)} className="w-full flex items-center justify-center gap-2 py-3 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-bold rounded-xl transition-colors shadow-sm">
            <Coffee size={18} /> 서버 운영 후원하기
          </button>
        </div>
      </aside>

      <main className="relative flex h-full flex-1 flex-col w-full">
        <div className="absolute top-4 right-4 z-50 hidden md:flex items-center gap-3">
          <button onClick={() => setShowManual(true)} className="px-3 py-2 rounded-xl bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#444] text-gray-700 dark:text-gray-200 text-sm font-bold shadow-sm hover:scale-105 transition-transform flex items-center gap-1.5">
            📖 메뉴얼
          </button>
          <a href="https://www.instagram.com/policyai.kr/" target="_blank" rel="noopener noreferrer" className="p-2.5 rounded-full bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#444] shadow-sm hover:scale-110 transition-transform flex items-center justify-center">
            <img src="/instagram-logo.png" alt="Instagram" className="w-5 h-5 object-contain" />
          </a>
          <button onClick={toggleTheme} className="p-2.5 rounded-full bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#444] text-gray-600 dark:text-gray-300 shadow-sm hover:scale-105 transition-transform">
            {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>

        <div className="flex items-center justify-between bg-white dark:bg-[#1a1a1a] p-4 border-b border-gray-200 dark:border-[#333] md:hidden shrink-0">
          <div className="font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>맞춤 혜택 찾기</div>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowManual(true)} className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#444] text-gray-700 dark:text-gray-200 text-xs font-bold shadow-sm hover:scale-105 transition-transform flex items-center gap-1">
              📖 메뉴얼
            </button>
            <a href="https://www.instagram.com/policyai.kr/" target="_blank" rel="noopener noreferrer" className="hover:scale-110 transition-transform flex items-center justify-center">
              <img src="/instagram-logo.png" alt="Instagram" className="w-6 h-6 object-contain" />
            </a>
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
                const isAssistant = message.role !== "user"; 
                
                const displayContent = (!loading && isLastMessage && isAssistant && !hasSummaryTable(message.content)) 
                  ? message.content + "\n\n" 
                  : message.content;

                return (
                  <div key={`${message.role}-${index}`} className={`flex gap-3 sm:gap-4 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                    
                    {isAssistant && (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-600 mt-1 shadow-sm">
                        <span className="text-[10px] sm:text-xs font-bold text-white">AI</span>
                      </div>
                    )}
                    
                    <div className={`max-w-[90%] sm:max-w-[85%] rounded-2xl p-4 shadow-sm overflow-hidden ${message.role === "user" ? "whitespace-pre-wrap border border-gray-200 dark:border-[#444] bg-white dark:bg-[#2d2d2d] text-gray-800 dark:text-gray-200 text-sm sm:text-base" : "bg-transparent text-gray-800 dark:text-gray-300"}`}>
                      
                      <div id={`capture-area-${index}`} className="p-1 rounded-xl">
                        {isAssistant ? (
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            rehypePlugins={[rehypeRaw]} 
                            components={{
                              p: ({ node, ...props }) => <p className="mb-3 leading-relaxed" {...props} />,
                              ul: ({ node, ...props }) => <ul className="list-disc pl-5 mb-4 space-y-1 marker:text-green-500" {...props} />,
                              ol: ({ node, ...props }) => <ol className="list-decimal pl-5 mb-4 space-y-1 marker:text-green-500 font-semibold" {...props} />,
                              li: ({ node, ...props }) => <li className="mb-1" {...props} />,
                              h1: ({ node, ...props }) => <h1 className="text-2xl font-extrabold mb-4 mt-6 text-gray-900 dark:text-white" {...props} />,
                              h2: ({ node, ...props }) => <h2 className="text-xl font-bold mb-3 mt-5 text-green-700 dark:text-green-400 border-b border-gray-200 dark:border-[#444] pb-2" {...props} />,
                              h3: ({ node, ...props }) => <h3 className="text-lg font-bold mb-3 mt-4 text-gray-800 dark:text-gray-100" {...props} />,
                              h4: ({ node, ...props }) => <h4 className="text-base font-bold mb-2 mt-4 text-gray-800 dark:text-gray-200" {...props} />,
                              h5: ({ node, ...props }) => <h5 className="text-sm font-bold mb-2 mt-3 text-gray-800 dark:text-gray-300" {...props} />,
                              strong: ({ node, ...props }) => <strong className="font-bold text-gray-900 dark:text-white bg-green-50 dark:bg-green-900/20 px-1.5 py-0.5 rounded" {...props} />,
                              a: ({ node, ...props }) => <a className="text-blue-600 dark:text-blue-400 hover:underline break-all font-bold" target="_blank" rel="noopener noreferrer" {...props} />,
                              hr: ({ node, ...props }) => <hr className="my-5 border-gray-300 dark:border-[#444]" {...props} />,
                              table: ({ node, ...props }) => (
                                <div className="overflow-x-auto mb-5 w-full rounded-xl border border-gray-300 dark:border-[#444] shadow-sm">
                                  <table className="min-w-full text-sm text-left" {...props} />
                                </div>
                              ),
                              thead: ({ node, ...props }) => <thead className="bg-gray-100 dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300" {...props} />,
                              th: ({ node, ...props }) => <th className="px-4 py-3 border-b border-gray-300 dark:border-[#444] font-bold whitespace-nowrap" {...props} />,
                              td: ({ node, ...props }) => <td className="px-4 py-3 border-b border-gray-200 dark:border-[#444]" {...props} />,
                              pre: ({ node, ...props }) => <pre className="bg-gray-100 dark:bg-[#2a2a2a] p-4 rounded-xl overflow-x-auto text-sm font-mono mb-4 border border-gray-200 dark:border-[#444]" {...props} />,
                              code: ({ node, className, ...props }) => {
                                const isInline = !className;
                                return <code className={`${className || ''} ${isInline ? 'bg-gray-100 dark:bg-[#2a2a2a] text-pink-600 dark:text-pink-400 px-1.5 py-0.5 rounded text-sm font-mono font-bold' : ''}`} {...props} />
                              },
                            }}
                          >
                            {displayContent}
                          </ReactMarkdown>
                        ) : (
                          <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>
                        )}
                      </div>
                      
                      {isLastMessage && isAssistant && loading && (
                        <div className="mt-4 flex items-center gap-2 text-sm font-bold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-4 py-2.5 rounded-xl w-fit animate-pulse border border-green-200 dark:border-green-800/30 shadow-sm">
                          <Loader2 size={16} className="animate-spin shrink-0" />
                          <span>{aiStatus || "좌뇌론 글 쓰고 우뇌론 검색 중! 🧠💥 멀티태스킹에 AI CPU가 울고 있으니 타자가 살짝 버벅여도 봐주세요 🥺💦"}</span>
                        </div>
                      )}

                      {!loading && isAssistant && message.content.length > 50 && (
                        <div className="mt-4 pt-3 border-t border-gray-200 dark:border-[#444] flex flex-wrap justify-end gap-2 animate-in fade-in duration-300">
                          <button onClick={() => downloadTextFile(message.content, `정책내비게이터_전체응답.txt`)} className="text-xs font-bold bg-gray-100 dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-[#333] transition-colors flex items-center gap-1 border border-gray-200 dark:border-[#444]">
                            <FileText size={14}/> 텍스트 저장
                          </button>
                          
                          {hasSummaryTable(message.content) && (
                            <button onClick={() => downloadTextFile(extractSummaryTableText(message.content), `정책내비게이터_요약표.txt`)} className="text-xs font-bold bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 px-3 py-1.5 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors flex items-center gap-1 border border-blue-200 dark:border-blue-800/30">
                              <Download size={14}/> 표 텍스트 저장
                            </button>
                          )}

                          <button onClick={() => downloadAsImage(`capture-area-${index}`, `정책내비게이터_결과.jpg`)} className="text-xs font-bold bg-pink-50 dark:bg-pink-900/20 text-pink-600 dark:text-pink-400 px-3 py-1.5 rounded-lg hover:bg-pink-100 dark:hover:bg-pink-900/40 transition-colors flex items-center gap-1 border border-pink-200 dark:border-pink-800/30">
                            <ImageIcon size={14}/> 이미지 저장
                          </button>
                          
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
                              } catch (err) { console.error('공유/복사 실패:', err); }
                            }} className="text-xs font-bold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-3 py-1.5 rounded-lg hover:bg-green-200 dark:hover:bg-green-800/50 transition-colors flex items-center gap-1 border border-green-200 dark:border-green-800/30">
                              🔗 공유하기
                          </button>
                        </div>
                      )}

                      {/* 🌟 버튼 렌더링을 완전히 제어 (표 인식도 정상화됨!) */}
                      {!loading && isLastMessage && isAssistant && !hasSummaryTable(message.content) && !hideFollowUpButton && (
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
              <div ref={messagesEndRef} />
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

      {showManual && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] px-4 animate-in fade-in duration-200" onClick={() => setShowManual(false)}>
          <div className="bg-white dark:bg-[#1e1e1e] p-6 rounded-2xl shadow-xl w-full max-w-lg relative border border-gray-200 dark:border-[#333] text-left max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <button onClick={() => setShowManual(false)} className="absolute top-4 right-4 p-1.5 rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"><X size={20} /></button>
            <h2 className="text-xl font-bold mb-4 border-b border-gray-200 dark:border-[#333] pb-3 text-gray-800 dark:text-gray-100 flex items-center gap-2">
              🧭 정책 내비게이터 100% 활용 가이드
            </h2>
            <div className="space-y-5 text-sm sm:text-base text-gray-700 dark:text-gray-300">
              <div>
                <strong className="text-green-600 dark:text-green-400 block mb-1">1️⃣ 나의 기본 정보 입력하기</strong>
                좌측 메뉴(모바일은 상단)에서 거주지와 출생연도를 선택해 주세요.<br/>
                <p className="mb-3 text-gray-300 leading-relaxed text-sm">
                  추가 정보 칸에 현재 상황(예: <em className="text-gray-400">대학교 4학년, 1인가구 무주택, 취업 준비 중</em>)을{' '}
                  <span className="font-bold text-blue-300 bg-blue-900/40 px-1.5 py-0.5 rounded">
                    구체적으로 입력할수록 AI가 더 많고 정확한 정책을 찾아옵니다.
                  </span>
                </p>
                <span className="text-red-500 dark:text-red-400 text-[13px] font-medium mt-1.5 block bg-red-50 dark:bg-red-900/20 p-2 rounded-md">※ 주의: 이름, 전화번호 등 민감한 개인정보는 절대 입력하지 마세요!</span>
              </div>
              
              <div>
                <strong className="text-green-600 dark:text-green-400 block mb-1">2️⃣ 맞춤 혜택 검색하기</strong>
                입력을 마쳤다면 <code className="bg-gray-100 dark:bg-[#2a2a2a] px-1.5 py-0.5 rounded text-green-700 dark:text-green-400 font-semibold">[🔍 맞춤 혜택 찾기]</code> 버튼을 눌러주세요.<br/>
                AI가 다양한 분야에서 신청 가능한 혜택을 싹 모아서 보기 좋게 정리해 드립니다.
              </div>
              
              <div>
                <strong className="text-green-600 dark:text-green-400 block mb-1">3️⃣ AI와 자유롭게 대화하기 (핵심 꿀팁!)</strong>
                검색 결과가 끝이 아닙니다! 하단 채팅창을 통해 사람과 대화하듯 질문해 보세요.<br/>
                <div className="bg-gray-50 dark:bg-[#2a2a2a] p-3 rounded-xl mt-2 text-sm text-gray-600 dark:text-gray-400 border border-gray-100 dark:border-[#333]">
                  💬 "이 중에서 당장 다음 달에 신청할 수 있는 것만 추려줘"<br/>
                  <div className="h-2"></div>
                  💬 "월세 지원 정책들만 조금 더 자세히 설명해 줄래?"
                </div>
              </div>
              
              <div>
                <strong className="text-green-600 dark:text-green-400 block mb-1">4️⃣ 🚨답변 이어보기 & 결과 저장하기🚨</strong>
                🚨혹시 혜택이 너무 많아 AI 답변이 중간에 멈췄나요?🚨<br/>
                결과 하단의 <code className="bg-gray-100 dark:bg-[#2a2a2a] px-1.5 py-0.5 rounded text-green-700 dark:text-green-400 font-semibold">[🔄 답변 이어서 생성하기]</code> 버튼을 누르거나, 채팅창에 <code className="bg-gray-100 dark:bg-[#2a2a2a] px-1.5 py-0.5 rounded text-green-700 dark:text-green-400 font-semibold">💬 "이어서 계속해줘"</code> 라고 입력하면 마저 알려줍니다.<br/>
                찾은 정보는 <code className="bg-gray-100 dark:bg-[#2a2a2a] px-1.5 py-0.5 rounded text-green-700 dark:text-green-400 font-semibold">[📸 이미지 저장]</code> 또는 <code className="bg-gray-100 dark:bg-[#2a2a2a] px-1.5 py-0.5 rounded text-green-700 dark:text-green-400 font-semibold">[🔗 공유하기]</code> 버튼을 눌러 기기에 저장해 보세요!
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-gray-700 text-center">
              <p className="text-sm text-gray-300 mb-2">💡 더 많은 정보나 서비스 건의사항이 있으신가요?</p>
              <a href="https://www.instagram.com/policyai.kr" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300 font-bold transition-colors text-sm">
                👉 공식 인스타그램 (@policyai.kr) 바로가기
              </a>
            </div>
            
            <div className="mt-6 pt-4 border-t border-gray-200 dark:border-[#333]">
              <button onClick={() => setShowManual(false)} className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-colors active:scale-95 shadow-sm">
                확인했습니다!
              </button>
            </div>
          </div>
        </div>
      )}

      {showDonation && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] px-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#1e1e1e] p-6 rounded-2xl shadow-xl w-full max-w-sm text-center relative border border-gray-200 dark:border-[#333]">
            <button onClick={() => setShowDonation(false)} className="absolute top-3 right-3 p-1 rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"><X size={20} /></button>
            <div className="w-16 h-16 bg-yellow-100 dark:bg-yellow-900/30 rounded-full flex items-center justify-center mx-auto mb-4"><Coffee size={32} className="text-yellow-600 dark:text-yellow-500" /></div>
            <h2 className="text-xl font-bold mb-2 text-gray-800 dark:text-gray-100">서버 운영에 힘 보태기</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6 leading-relaxed">AI 데이터 처리 비용과 서버 인프라 유지비로 사용됩니다.<br/>여러분의 소중한 후원이 서비스 발전에 큰 힘이 됩니다. 🙌🙇‍♂️</p>
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
