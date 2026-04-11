import axios from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://policy-navigator-1.onrender.com';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  // 90000(90초) -> 300000(5분)으로 변경. (또는 0으로 주면 프론트엔드는 무한 대기함)
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

  // 🌟 [새로 추가된 부분] 관리자 대시보드 통계 가져오기
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
