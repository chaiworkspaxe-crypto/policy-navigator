import axios from 'axios';

// 🌟 [핵심 수술 1] 파이썬 외부 주소를 버리고, Next.js 내부 API(/api)로 연결!
const apiClient = axios.create({
  baseURL: '/api', 
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
  // 🌟 [핵심 수술 2] 복잡했던 주소들을 직관적인 쿼리 파라미터 구조로 단순화!
  listThreads: async (userId: string): Promise<ThreadItem[]> => {
    const res = await apiClient.get("/threads", { params: { user_id: userId } });
    return res.data.threads || [];
  },

  createThread: async (userId: string): Promise<string> => {
    const res = await apiClient.post("/threads", { user_id: userId });
    return res.data.thread_id;
  },

  loadMessages: async (userId: string, threadId: string): Promise<ChatMessage[]> => {
    const res = await apiClient.get("/messages", { params: { user_id: userId, thread_id: threadId } });
    return res.data.messages || [];
  },

  loadThreadInputs: async (userId: string, threadId: string): Promise<ThreadInputs | null> => {
    const res = await apiClient.get("/inputs", { params: { user_id: userId, thread_id: threadId } });
    return res.data.inputs || null;
  },

  saveThreadInputs: async (userId: string, threadId: string, payload: Partial<ThreadInputs>): Promise<void> => {
    await apiClient.post("/inputs", { user_id: userId, thread_id: threadId, ...payload });
  },

  // 🌟 [수술 10️⃣] deleteThread 보정 적용 완료!
  deleteThread: async (userId: string, threadId: string): Promise<void> => {
    await apiClient.delete('/threads', {
      params: { user_id: userId, thread_id: threadId },
    });
  },

  deleteAllThreads: async (userId: string): Promise<void> => {
    await apiClient.delete("/threads", { params: { user_id: userId, delete_all: 'true' } });
  },

  getAdminStats: async (): Promise<any> => {
    const res = await apiClient.get("/admin/stats");
    return res.data.data;
  },

  getAdminPolicies: async (): Promise<any> => {
    const res = await apiClient.get("/admin/policies");
    return res.data;
  },
};

export function extractApiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (typeof error.message === "string" && error.message.trim()) return error.message;
  }
  return "클라우드 통신 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
}
