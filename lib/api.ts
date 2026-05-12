// lib/api.ts
import axios, { AxiosError } from 'axios';

// 🌟 [최적화] timeout을 300초(5분)에서 15초로 단축하여 Fail-Fast 유도
const apiClient = axios.create({
  baseURL: '/api', 
  timeout: 15_000, // 스트리밍은 useChatStream 내의 fetch로 처리되므로 영향 없음
});

// 🌟 [최적화] 인터셉터 단순화. 불필요한 분기 제거 및 429 로깅 추가
apiClient.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    // 429 (Rate limit): 향후 토스트 표시용 이벤트 발행 등 확장 가능
    if (err.response?.status === 429) {
      console.warn('[API] rate limited');
    }
    return Promise.reject(err);
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

// 🌟 [최적화] 영문 시스템 에러 노출을 막고 사용자 친화적인 한국어 메시지 제공
export function extractApiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    // 1) 서버에서 한국어로 보낸 detail 우선 적용 (단, 15자 이상의 연속된 영문이 포함된 경우 생얼 에러로 간주하여 무시)
    const detail = error.response?.data?.detail ?? error.response?.data?.error;
    if (typeof detail === "string" && detail.trim() && !/[A-Za-z]{15,}/.test(detail)) {
      return detail;
    }
    
    // 2) HTTP Status Code별 친절한 한국어 메시지 맵핑
    const status = error.response?.status;
    if (status === 403) return '권한이 없습니다. 새 대화를 시작해 주세요.';
    if (status === 404) return '요청한 데이터를 찾을 수 없어요.';
    if (status === 429) return '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.';
    if (status && status >= 500) return '서버에 일시적인 문제가 있어요. 잠시 후 다시 시도해 주세요.';
    
    // 3) Timeout 등의 네트워크 에러 처리
    if (error.code === 'ECONNABORTED') return '요청이 시간 내에 완료되지 않았어요. 네트워크를 확인해 주세요.';
  }
  
  // 4) 최후의 Fallback
  return "클라우드 통신 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
}
