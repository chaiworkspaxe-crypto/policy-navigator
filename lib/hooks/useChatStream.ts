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
  
  // 🌟 [고급화 포인트] 네트워크 요청을 강제로 끊을 수 있는 컨트롤러
  const abortControllerRef = useRef<AbortController | null>(null);

  // 🌟 [추가 기능] 답변 생성 중지 함수
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
          signal: abortControllerRef.current.signal, // 🌟 컨트롤러 연결!
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

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const dataStr = line.replace(/^data:\s*/, '').trim();
            if (!dataStr) continue;
            try {
              const data = JSON.parse(dataStr);
              if (data.type === 'content') {
                accumulated += data.delta;
                handlers.onDelta?.(data.delta, accumulated);
                setAiStatus(''); // 글자가 오면 상태 메시지 깔끔하게 비우기
              } else if (data.type === 'status') {
                setAiStatus(data.message);
                handlers.onStatus?.(data.message);
              } else if (data.type === 'error') {
                handlers.onError?.(data.message);
              } else if (data.type === 'done') {
                handlers.onDone?.(data.full_content ?? accumulated);
              }
            } catch {
              // 부분 청크 — 무시
            }
          }
        }
      } catch (err: any) {
        // 🌟 [고급화 포인트] 유저가 강제로 끊은 에러는 무시 처리
        if (err.name === 'AbortError') {
          console.log('[useChatStream] 사용자에 의해 스트리밍이 중단되었습니다.');
        } else {
          console.error('[useChatStream]', err);
          handlers.onError?.('서버 상태가 불안정합니다. 잠시 후 다시 시도해주세요.');
        }
      } finally {
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [],
  );

  // 🌟 외부에서 stop 함수도 꺼내 쓸 수 있도록 반환!
  return { stream, stop, isStreaming, aiStatus, setAiStatus };
}
