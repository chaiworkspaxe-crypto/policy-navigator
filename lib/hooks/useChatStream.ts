// lib/hooks/useChatStream.ts
'use client';

import { useState, useCallback, useRef } from 'react';
import { ChatMessage } from '@/lib/api';

interface StreamOpts {
  userId: string;
  threadId: string;
  messages: ChatMessage[];
  newUserContent: string;
}

interface StreamHandlers {
  onDelta?: (delta: string, accumulated: string) => void;
  onStatus?: (status: string) => void;
  onError?: (msg: string) => void;
  onDone?: (full: string) => void;
}

export function useChatStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [aiStatus, setAiStatus] = useState('');
  
  // 🌟 네트워크 요청을 강제로 끊을 수 있는 컨트롤러
  const abortControllerRef = useRef<AbortController | null>(null);

  // 🌟 답변 생성 중지 함수
  const stop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort(); // 네트워크 요청 즉시 차단
      abortControllerRef.current = null;
      setIsStreaming(false);
      setAiStatus('');
    }
  }, []);

  const stream = useCallback(
    async (opts: StreamOpts, handlers: StreamHandlers = {}) => {
      // 이전 스트리밍이 돌고 있다면 안전하게 컷!
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      
      abortControllerRef.current = new AbortController();
      setIsStreaming(true);
      setAiStatus('');

      // 🌟 [개선 1] 무응답 Watchdog (감시견) — 30초 동안 데이터 없으면 자동 중단
      let watchdogId: ReturnType<typeof setTimeout> | null = null;
      const resetWatchdog = () => {
        if (watchdogId) clearTimeout(watchdogId);
        watchdogId = setTimeout(() => {
          console.warn('[useChatStream] 30초 응답 지연 — 자동 중단 발동');
          abortControllerRef.current?.abort();
        }, 30_000); // 30초
      };

      const newMessages = [
        ...opts.messages,
        { role: 'user' as const, content: opts.newUserContent },
      ];

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: newMessages,
            userId: opts.userId,
            threadId: opts.threadId,
          }),
          signal: abortControllerRef.current.signal, 
        });

        if (response.status === 403) {
          const errorData = await response.json().catch(() => ({}));
          handlers.onError?.(
            errorData.detail || '오늘의 검색 횟수를 모두 사용했습니다.',
          );
          return;
        }
        if (!response.ok) {
          handlers.onError?.('서버 통신 오류');
          return;
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder('utf-8');
        let accumulated = '';
        let buffer = '';

        if (!reader) {
          handlers.onError?.('스트림을 열 수 없습니다.');
          return;
        }

        resetWatchdog(); // 첫 watchdog 시작!

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          resetWatchdog(); // 🌟 데이터가 올 때마다 30초 타이머 리셋

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? ''; // 마지막 부분 청크는 buffer에 남김

          for (const line of lines) {
            // 🌟 [개선 3] 의미 없는 SSE 잔재(data:) 치환 로직 제거, 순수 NDJSON 처리
            const trimmed = line.trim();
            if (!trimmed) continue;

            let data: any;
            try {
              data = JSON.parse(trimmed);
            } catch (parseErr) {
              // 🌟 [개선 2] 진짜 파싱 실패는 로깅하여 데이터 깨짐 현상 추적
              console.warn('[useChatStream] JSON parse 실패:', trimmed.slice(0, 100));
              continue;
            }

            if (data.type === 'content' && typeof data.delta === 'string') {
              accumulated += data.delta;
              handlers.onDelta?.(data.delta, accumulated);
              setAiStatus(''); 
            } else if (data.type === 'status') {
              setAiStatus(data.message);
              handlers.onStatus?.(data.message);
            } else if (data.type === 'error') {
              handlers.onError?.(data.message);
            } else if (data.type === 'done') {
              handlers.onDone?.(data.full_content ?? accumulated);
            }
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          console.log('[useChatStream] 사용자에 의해 스트리밍이 중단되었습니다.');
        } else {
          console.error('[useChatStream]', err);
          handlers.onError?.('서버 상태가 불안정합니다. 잠시 후 다시 시도해주세요.');
        }
      } finally {
        if (watchdogId) clearTimeout(watchdogId); // 🌟 스트림 끝나면 감시견 퇴근
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [],
  );

  return { stream, stop, isStreaming, aiStatus, setAiStatus };
}
