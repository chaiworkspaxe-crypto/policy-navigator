"use client";

import { useEffect, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  api,
  ChatMessage,
  extractApiErrorMessage,
  ThreadInputs,
  ThreadItem,
} from "@/lib/api";
import { CITY_TO_DISTRICTS, DONG_MAP } from "@/lib/regionData";
import MarkdownMessage from "@/components/MarkdownMessage";
import {
  MessageSquare,
  Plus,
  Send,
  Loader2,
  MapPin,
  Search,
  AlertCircle,
  Menu,
  X,
} from "lucide-react";

const DEFAULT_CITY = "선택하세요";
const DEFAULT_DONG = "선택 안 함";

const EMPTY_INPUTS: ThreadInputs = {
  selected_city: DEFAULT_CITY,
  selected_district: DEFAULT_CITY,
  selected_dong: DEFAULT_DONG,
  birth_year: "",
  extra_info: "",
};

export default function Home() {
  const [userId, setUserId] = useState("");
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  
  // 🌟 모바일 사이드바 토글 상태
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

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
    if (!storedId) {
      storedId = `user_${uuidv4()}`;
      localStorage.setItem("pn_user_id", storedId);
    }

    setUserId(storedId);
    void loadThreads(storedId);
  }, []);

  const applyInputs = (inputs?: Partial<ThreadInputs> | null) => {
    const nextCity = inputs?.selected_city || EMPTY_INPUTS.selected_city;
    const nextDistrict = inputs?.selected_district || EMPTY_INPUTS.selected_district;
    const nextDong = inputs?.selected_dong || EMPTY_INPUTS.selected_dong;

    setCity(nextCity);
    setDistrict(nextDistrict);
    setDong(nextDong);
    setBirthYear(inputs?.birth_year || "");
    setExtraInfo(inputs?.extra_info || "");
  };

  const loadThreads = async (uid: string) => {
    try {
      setErrorMessage("");
      const threadList = await api.listThreads(uid);
      setThreads(threadList);

      if (threadList.length === 0) {
        await handleNewThread(uid);
        return;
      }

      const shouldKeepCurrent = threadList.some((thread) => thread.thread_id === currentThreadId);
      const targetThreadId = shouldKeepCurrent ? currentThreadId : threadList[0].thread_id;

      if (targetThreadId) {
        await selectThread(uid, targetThreadId);
      }
    } catch (error) {
      console.error("[통신 에러 - 대화 목록]:", error);
      setErrorMessage("서버와 연결할 수 없습니다.");
    }
  };

  const selectThread = async (uid: string, tid: string) => {
    try {
      setErrorMessage("");
      setCurrentThreadId(tid);
      setMessages([]);
      setQuery("");
      setIsSidebarOpen(false);

      const [loadedMessages, loadedInputs] = await Promise.all([
        api.loadMessages(uid, tid),
        api.loadThreadInputs(uid, tid),
      ]);

      setMessages(loadedMessages);
      applyInputs(loadedInputs);
    } catch (error) {
      console.error("[통신 에러 - 대화 불러오기]:", error);
      setErrorMessage(extractApiErrorMessage(error));
    }
  };

  const handleNewThread = async (uid = userId) => {
    try {
      setErrorMessage("");
      const newThreadId = await api.createThread(uid);
      setCurrentThreadId(newThreadId);
      setMessages([]);
      setQuery("");
      applyInputs(EMPTY_INPUTS);
      setIsSidebarOpen(false);

      const threadList = await api.listThreads(uid);
      setThreads(threadList);
    } catch (error) {
      console.error("[통신 에러 - 새 대화 생성]:", error);
      setErrorMessage("새 대화방을 만들 수 없습니다.");
    }
  };

  const validateStructuredSearch = () => {
    if (!city || city === DEFAULT_CITY) return "시/도를 선택해주세요.";
    if (!district || district === DEFAULT_CITY) return "시/군/구를 선택해주세요.";
    if (!/^\d{4}$/.test(birthYear)) return "출생연도는 4자리 숫자로 입력해주세요.";
    if (!extraInfo.trim()) return "추가 정보를 입력해주세요.";
    return "";
  };

  const handleSearch = async (isFollowUp = false) => {
    setErrorMessage("");

    if (!userId) {
      setErrorMessage("사용자 정보가 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }

    // 🌟 [핵심 복구 로직] 대화방 ID가 없으면 버튼 누른 시점에 강제 생성
    let targetThreadId = currentThreadId;
    if (!targetThreadId) {
      console.log("대화방 ID가 없어 새로 생성을 시도합니다...");
      try {
        targetThreadId = await api.createThread(userId);
        setCurrentThreadId(targetThreadId); // 상태 업데이트 (비동기)
      } catch (err) {
        setErrorMessage("서버와 연결이 원활하지 않아 대화방을 만들 수 없습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
    }

    if (isFollowUp) {
      if (!query.trim()) return setErrorMessage("추가 질문을 입력해주세요.");
      if (messages.length === 0) return setErrorMessage("먼저 기본 조건으로 혜택을 조회해주세요.");
    } else {
      const validationMessage = validateStructuredSearch();
      if (validationMessage) return setErrorMessage(validationMessage);
    }

    const followUpText = query.trim();
    const optimisticUserMessage = isFollowUp
      ? followUpText
      : `📍 ${city} ${district} ${dong !== DEFAULT_DONG ? dong : ""} | 🎂 ${birthYear}년생 | 📝 ${extraInfo}`;

    setLoading(true);
    setMessages((prev) => [...prev, { role: "user", content: optimisticUserMessage }]);
    if (isFollowUp) setQuery("");

    try {
      // 🔥 여기서 currentThreadId 대신 방금 복구한 targetThreadId 사용!
      await api.saveThreadInputs(userId, targetThreadId, {
        selected_city: city,
        selected_district: district,
        selected_dong: dong,
        birth_year: birthYear,
        extra_info: extraInfo,
      });

      const response = await api.getAiResponse({
        user_id: userId,
        thread_id: targetThreadId, // 🔥 여기도 targetThreadId 사용
        city: isFollowUp ? undefined : city,
        district: isFollowUp ? undefined : district,
        dong: isFollowUp ? undefined : dong === DEFAULT_DONG ? "" : dong,
        birth_year: isFollowUp ? undefined : birthYear,
        extra_info: isFollowUp ? undefined : extraInfo,
        query: isFollowUp ? followUpText : undefined,
      });

      if (response.thread_id && response.thread_id !== targetThreadId) {
        setCurrentThreadId(response.thread_id);
      }

      setMessages((prev) => [...prev, { role: "assistant", content: response.answer }]);
      const threadList = await api.listThreads(userId);
      setThreads(threadList);

    } catch (error) {
      console.error("[통신 에러 - AI 응답 요청]:", error);
      setMessages((prev) => prev.slice(0, -1));
      setErrorMessage(extractApiErrorMessage(error) || "분석 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-[100dvh] bg-[#121212] text-gray-100 font-sans overflow-hidden">
      
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <aside 
        className={`fixed inset-y-0 left-0 z-50 w-72 flex flex-col bg-[#1e1e1e] border-r border-[#333] transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-[#333] p-4">
          <h1 className="flex items-center gap-2 text-lg font-bold text-green-400">
            <Search size={20} /> 정책 내비게이터
          </h1>
          <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-gray-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        <div className="p-4">
          <button
            onClick={() => void handleNewThread()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#444] bg-[#2d2d2d] py-2.5 font-semibold transition hover:bg-[#3d3d3d] active:scale-95"
          >
            <Plus size={18} /> 새 대화 시작
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-3">
          <p className="mb-2 px-1 text-xs font-bold text-gray-500">대화 목록</p>
          {threads.map((thread) => (
            <button
              key={thread.thread_id}
              type="button"
              onClick={() => void selectThread(userId, thread.thread_id)}
              className={`mb-1 flex w-full items-center justify-between rounded-xl p-3 text-left transition ${
                currentThreadId === thread.thread_id
                  ? "border border-green-500/30 bg-green-500/10 text-green-400"
                  : "text-gray-300 hover:bg-[#2a2a2a]"
              }`}
            >
              <div className="flex min-w-0 items-center gap-2 truncate">
                <MessageSquare size={16} className="shrink-0" />
                <span className="truncate text-sm">{thread.title || "새 대화"}</span>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <main className="relative flex h-full flex-1 flex-col w-full">
        
        <div className="flex items-center justify-between bg-[#1a1a1a] p-4 border-b border-[#333] md:hidden shrink-0">
          <div className="font-bold text-gray-100 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
            맞춤 혜택 찾기
          </div>
          <button onClick={() => setIsSidebarOpen(true)} className="text-gray-300 hover:text-white">
            <Menu size={24} />
          </button>
        </div>

        <div className="shrink-0 border-b border-[#333] bg-[#1a1a1a] p-4">
          <div className="mx-auto max-w-4xl space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <select
                className="w-full rounded-lg border border-[#444] bg-[#2a2a2a] p-3 text-sm sm:p-2.5 outline-none transition focus:border-green-500"
                value={city}
                onChange={(e) => { setCity(e.target.value); setDistrict(DEFAULT_CITY); setDong(DEFAULT_DONG); }}
              >
                <option>{DEFAULT_CITY}</option>
                {Object.keys(CITY_TO_DISTRICTS).map((cityName) => (
                  <option key={cityName}>{cityName}</option>
                ))}
              </select>

              <select
                className="w-full rounded-lg border border-[#444] bg-[#2a2a2a] p-3 text-sm sm:p-2.5 outline-none transition focus:border-green-500"
                value={district}
                onChange={(e) => { setDistrict(e.target.value); setDong(DEFAULT_DONG); }}
                disabled={city === DEFAULT_CITY}
              >
                <option>{DEFAULT_CITY}</option>
                {availableDistricts.map((districtName) => (
                  <option key={districtName}>{districtName}</option>
                ))}
              </select>

              <select
                className="w-full rounded-lg border border-[#444] bg-[#2a2a2a] p-3 text-sm sm:p-2.5 outline-none transition focus:border-green-500"
                value={dong}
                onChange={(e) => setDong(e.target.value)}
                disabled={district === DEFAULT_CITY}
              >
                <option>{DEFAULT_DONG}</option>
                {availableDongs.map((dongName) => (
                  <option key={dongName}>{dongName}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="tel"
                placeholder="출생연도 (예: 1999)"
                maxLength={4}
                className="w-full rounded-lg border border-[#444] bg-[#2a2a2a] p-3 text-sm sm:p-2.5 outline-none transition focus:border-green-500 sm:w-1/3"
                value={birthYear}
                onChange={(e) => setBirthYear(e.target.value.replace(/[^0-9]/g, ""))}
              />
              <input
                type="text"
                placeholder="추가 정보 (예: 대학생, 1인가구)"
                className="w-full rounded-lg border border-[#444] bg-[#2a2a2a] p-3 text-sm sm:p-2.5 outline-none transition focus:border-green-500 sm:w-2/3"
                value={extraInfo}
                onChange={(e) => setExtraInfo(e.target.value)}
              />
            </div>

            <button
              onClick={() => void handleSearch(false)}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 py-3.5 sm:py-3 font-bold text-white transition hover:bg-green-500 disabled:opacity-50 active:scale-[0.98]"
            >
              {loading ? <Loader2 className="animate-spin" /> : <Search size={20} />}
              맞춤 혜택 찾기
            </button>

            {errorMessage && (
              <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-y-auto p-4 sm:p-8 scroll-smooth">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-gray-500 text-center px-4">
              <MapPin size={48} className="mb-4 opacity-20" />
              <p className="text-sm sm:text-base">거주지와 정보를 입력하고<br className="sm:hidden" /> 당신만의 혜택을 찾아보세요.</p>
            </div>
          ) : (
            <div className="space-y-6 pb-4">
              {messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`flex gap-3 sm:gap-4 ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {message.role === "assistant" && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-600 mt-1">
                      <span className="text-[10px] sm:text-xs font-bold text-white">AI</span>
                    </div>
                  )}

                  <div
                    className={`max-w-[90%] sm:max-w-[85%] rounded-2xl p-4 shadow-sm overflow-hidden ${
                      message.role === "user"
                        ? "whitespace-pre-wrap border border-[#444] bg-[#2d2d2d] text-gray-200 text-sm sm:text-base"
                        : "bg-transparent text-gray-300"
                    }`}
                  >
                    {message.role === "assistant" ? (
                      <MarkdownMessage content={message.content} />
                    ) : (
                      <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {loading && (
            <div className="mt-4 flex justify-start gap-3 sm:gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-600">
                <Loader2 size={16} className="animate-spin text-white" />
              </div>
              <div className="p-3 text-sm text-gray-400">데이터를 분석 중입니다...</div>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-[#333] bg-[#121212] p-3 sm:p-4 pb-safe">
          <div className="relative mx-auto max-w-4xl">
            <input
              type="text"
              placeholder="추가 질문을 입력하세요 (예: 청년 혜택만 다시)"
              className="w-full rounded-full border border-[#444] bg-[#1e1e1e] py-3.5 pl-5 pr-12 text-sm text-white outline-none transition focus:border-green-500"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSearch(true);
              }}
              disabled={messages.length === 0 || loading}
            />
            <button
              onClick={() => void handleSearch(true)}
              disabled={!query.trim() || loading}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-green-600 p-2 text-white transition hover:bg-green-500 disabled:opacity-50"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}