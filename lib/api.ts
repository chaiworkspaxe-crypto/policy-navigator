// lib/api.ts
import axios, { AxiosError } from 'axios';

// 🌟 [최적화] timeout을 300초(5분)에서 15초로 단축하여 Fail-Fast 유도
const apiClient = axios.create({
  baseURL: '/api', 
  timeout: 15_000, // 스트리밍은 useChatStream 내의 fetch로 처리되므로 영향 없음
});

// 🌟 [신규] 응답 인터셉터로 에러 메시지 일관 처리
apiClient.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    // 401/403 같은 권한 에러는 즉시 throw해서 호출처가 명확하게 분기 처리할 수 있게 함
    if (err.response?.status === 403) return Promise.reject(err);
    return Promise.reject(err);   // 그 외 에러도 호출처의 catch 블록으로 넘김
  },
);

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

export interface LoadMessagesResult {
  messages: ChatMessage[];
  nextBefore: string | null;     // 더 이전 메시지가 있을 때 cursor
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

  loadMessages: async (
    userId: string,
    threadId: string,
    opts?: { limit?: number; before?: string }
  ): Promise<LoadMessagesResult> => {
    const res = await apiClient.get("/messages", {
      params: {
        user_id: userId,
        thread_id: threadId,
        limit: opts?.limit ?? 20, 
        ...(opts?.before ? { before: opts.before } : {}),
      },
    });
    return {
      messages: res.data.messages || [],
      nextBefore: res.data.nextBefore ?? null,
    };
  },

  loadThreadInputs: async (userId: string, threadId: string): Promise<ThreadInputs | null> => {
    const res = await apiClient.get("/inputs", { params: { user_id: userId, thread_id: threadId } });
    return res.data.inputs || null;
  },

  saveThreadInputs: async (userId: string, threadId: string, payload: Partial<ThreadInputs>): Promise<void> => {
    await apiClient.post("/inputs", { user_id: userId, thread_id: threadId, ...payload });
  },

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

  getActiveUserStats: async (): Promise<{ today: number; week: number; month: number }> => {
    try {
      const res = await apiClient.get("/admin/active-users");
      return res.data;
    } catch (error) {
      console.error("통계 불러오기 실패:", error);
      return { today: 0, week: 0, month: 0 };
    }
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
