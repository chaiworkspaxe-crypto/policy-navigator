import axios from 'axios';

// 🌟 [체크포인트] Vercel 환경변수에 NEXT_PUBLIC_API_BASE_URL 이 잘 들어가 있는지 꼭 확인해!
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://policy-navigator-1.onrender.com';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  // AI 응답 대기 시간을 위해 5분(300000ms)으로 세팅 (아주 좋은 설정!)
  timeout: 300000, 
});

export interface ThreadItem {
  thread_id: string;
  title: string;
  created_at?: string;
  updated_at?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  message_type?: string;
  created_at?: string;
}

export interface ThreadInputs {
  selected_city: string;
  selected_district: string;
  selected_dong: string;
  birth_year: string;
  extra_info: string;
}

export const api = {
  listThreads: async (userId: string): Promise<ThreadItem[]> => {
    const res = await apiClient.get("/threads", { params: { user_id: userId } });
    return res.data.threads || [];
  },

  createThread: async (userId: string): Promise<string> => {
    const res = await apiClient.post("/threads", { user_id: userId });
    return res.data.thread_id;
  },

  loadMessages: async (userId: string, threadId: string): Promise<ChatMessage[]> => {
    const res = await apiClient.get(`/threads/${threadId}/messages`, {
      params: { user_id: userId },
    });
    return res.data.messages || [];
  },

  loadThreadInputs: async (userId: string, threadId: string): Promise<ThreadInputs | null> => {
    const res = await apiClient.get(`/threads/${threadId}/inputs`, {
      params: { user_id: userId },
    });
    return res.data.inputs || null;
  },

  saveThreadInputs: async (
    userId: string,
    threadId: string,
    payload: Partial<ThreadInputs>,
  ): Promise<void> => {
    await apiClient.post(`/threads/${threadId}/inputs`, {
      user_id: userId,
      selected_city: payload.selected_city,
      selected_district: payload.selected_district,
      selected_dong: payload.selected_dong,
      birth_year: payload.birth_year,
      extra_info: payload.extra_info,
    });
  },

  deleteThread: async (userId: string, threadId: string): Promise<void> => {
    await apiClient.delete(`/threads/${threadId}`, { params: { user_id: userId } });
  },

  // 🌟 [추가] 전체 대화 삭제 API
  deleteAllThreads: async (userId: string): Promise<void> => {
    await apiClient.delete(`/threads/all`, { params: { user_id: userId } });
  },

  getAdminStats: async (): Promise<{ total_users: number; total_threads: number; blocked_today: number; today_date: string }> => {
    const res = await apiClient.get("/admin/stats");
    return res.data.data;
  },

  getAiResponse: async (payload: {
    user_id: string;
    thread_id: string;
    city?: string;
    district?: string;
    dong?: string;
    birth_year?: string;
    extra_info?: string;
    query?: string;
  }): Promise<{ answer: string; thread_id: string }> => {
    const res = await apiClient.post("/chat", payload);
    return {
      answer: res.data.answer,
      thread_id: res.data.thread_id,
    };
  },
};

export function extractApiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }

    if (typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
  }

  return "클라우드 통신 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
}
