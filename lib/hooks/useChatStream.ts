// lib/hooks/useChatStream.ts
'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
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
  onFirstDelta?: () => void;     
}

export function useChatStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [aiStatus, setAiStatus] = useState('');
  
  const abortControllerRef = useRef<AbortController | null>(null);
  
  // 🌟 [최적화] 컴포넌트 생존 여부 추적 (메모리 누수 및 React 경고 방어)
  const isMountedRef = useRef(true);

  // 컴포넌트가 사라질 때(Unmount) 통신을 강제로 끊고 생존 플래그를 내림
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // 🌟 안전한 State 업데이트 함수 (컴포넌트가 살아있을 때만 작동)
  const safeSetIsStreaming = useCallback((v: boolean) => {
    if (isMountedRef.current) setIsStreaming(v);
  }, []);

  const safeSetAiStatus = useCallback((v: string) => {
    if (isMountedRef.current) setAiStatus(v);
  }, []);

  const stop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort(); 
      abortControllerRef.current = null;
      safeSetIsStreaming(false);
      safeSetAiStatus('');
    }
  }, [safeSetIsStreaming, safeSetAiStatus]);

  const stream = useCallback(
    async (opts: StreamOpts, handlers: StreamHandlers = {}) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      
      abortControllerRef.current = new AbortController();
      safeSetIsStreaming(true);
      safeSetAiStatus('');

      let watchdogId: ReturnType<typeof setTimeout> | null = null;
      let contentWatchdogId: ReturnType<typeof setTimeout> | null = null; 
      let isFirstChunk = true;
      let firstDeltaFired = false; 
      let watchdogTimedOut = false;  

      const CONNECT_TIMEOUT_MS = 60_000;
      const IDLE_TIMEOUT_MS = 45_000;
      
      // 🌟 [개선] 슬라이딩 윈도우 타이머 변수
      const NO_CONTENT_TIMEOUT_INITIAL_MS = 90_000;      // 초기 컨텐츠 대기 시간
      const NO_CONTENT_EXTENSION_PER_STATUS_MS = 25_000; // status 수신 시 연장할 시간
      const NO_CONTENT_HARD_CAP_MS = 240_000;            // 절대 상한 240초 (Vercel 300초 보호)

      const streamStartedAt = Date.now();
      let contentWatchdogDeadline = streamStartedAt + NO_CONTENT_TIMEOUT_INITIAL_MS;

      const resetWatchdog = () => {
        if (watchdogId) clearTimeout(watchdogId);
        const ms = isFirstChunk ? CONNECT_TIMEOUT_MS : IDLE_TIMEOUT_MS;
        watchdogId = setTimeout(() => {
          console.warn(`[useChatStream] ${ms / 1000}초 응답 지연 — 자동 중단 발동 (firstChunk=${isFirstChunk})`);
          watchdogTimedOut = true;     
          abortControllerRef.current?.abort();
        }, ms);
      };

      // 🌟 [신규] 콘텐츠 워치독 (남은 시간만큼 예약)
      const scheduleContentWatchdog = () => {
        if (contentWatchdogId) clearTimeout(contentWatchdogId);
        const remaining = Math.max(0, contentWatchdogDeadline - Date.now());
        contentWatchdogId = setTimeout(() => {
          console.warn(`[useChatStream] content 워치독 발동 (소요시간: ${(Date.now() - streamStartedAt) / 1000}초)`);
          watchdogTimedOut = true;
          abortControllerRef.current?.abort();
        }, remaining);
      };

      // 🌟 [신규] 상태 수신 시 콘텐츠 워치독 연장 (Hard Cap 제한)
      const extendContentWatchdog = (extensionMs: number) => {
        const hardCap = streamStartedAt + NO_CONTENT_HARD_CAP_MS;
        const proposed = Date.now() + extensionMs;
        contentWatchdogDeadline = Math.min(proposed, hardCap);
        scheduleContentWatchdog();
      };

      // 🌟 [신규] 텍스트 도착 시 풀 리셋
      const resetContentWatchdog = () => {
        contentWatchdogDeadline = Date.now() + NO_CONTENT_TIMEOUT_INITIAL_MS;
        scheduleContentWatchdog();
      };

      // 🌟 중복 메시지 전송 방어
      const lastMsg = opts.messages[opts.messages.length - 1];
      const alreadyHasNewMsg =
        lastMsg?.role === 'user' &&
        typeof lastMsg.content === 'string' &&
        lastMsg.content === opts.newUserContent;

      const newMessages = alreadyHasNewMsg
        ? opts.messages 
        : [...opts.messages, { role: 'user' as const, content: opts.newUserContent }]; 

      let accumulated = ''; 

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
          if (isMountedRef.current) {
            handlers.onError?.(errorData.detail || '오늘의 검색 횟수를 모두 사용했습니다.');
          }
          return;
        }
        if (!response.ok) {
          if (isMountedRef.current) handlers.onError?.('서버 통신 오류');
          return;
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        if (!reader) {
          if (isMountedRef.current) handlers.onError?.('스트림을 열 수 없습니다.');
          return;
        }

        resetWatchdog(); 
        resetContentWatchdog(); // 읽기 시작과 함께 가동

        while (true) {
          if (!isMountedRef.current) break;

          const { done, value } = await reader.read();
          if (done) break;
          
          isFirstChunk = false;        
          resetWatchdog();             

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? ''; 

          for (const line of lines) {
            if (!isMountedRef.current) break;

            const trimmed = line.trim();
            if (!trimmed) continue;

            let data: any;
            try {
              data = JSON.parse(trimmed);
            } catch (parseErr) {
              console.warn('[useChatStream] JSON parse 실패:', trimmed.slice(0, 100));
              continue;
            }

            if (data.type === 'content' && typeof data.delta === 'string') {
              if (!firstDeltaFired) {
                firstDeltaFired = true;
                handlers.onFirstDelta?.();
              }
              accumulated += data.delta;
              handlers.onDelta?.(data.delta, accumulated);
              
              safeSetAiStatus(''); 
              resetContentWatchdog(); // 🌟 실제 텍스트가 도착했을 때 풀 리셋
            } else if (data.type === 'status') {
              safeSetAiStatus(data.message);
              handlers.onStatus?.(data.message);
              
              // 🌟 status 도착 = 서버 살아있음 신호 → content 워치독을 25초 연장 (단, 240초 hard cap)
              extendContentWatchdog(NO_CONTENT_EXTENSION_PER_STATUS_MS);
              
            } else if (data.type === 'error') {
              handlers.onError?.(data.message);
            } else if (data.type === 'done') {
              handlers.onDone?.(data.full_content ?? accumulated);
            }
          }
        }

        const tail = buffer.trim();
        if (tail && isMountedRef.current) {
          try {
            const data = JSON.parse(tail);
            if (data.type === 'content' && typeof data.delta === 'string') {
              if (!firstDeltaFired) {
                firstDeltaFired = true;
                handlers.onFirstDelta?.();
              }
              accumulated += data.delta;
              handlers.onDelta?.(data.delta, accumulated);
            } else if (data.type === 'done') {
              handlers.onDone?.(data.full_content ?? accumulated);
            }
          } catch {/* 쓰레기 값이면 조용히 무시 */}
        }

      } catch (err: any) {
        if (!isMountedRef.current) return; 
        
        if (err.name === 'AbortError') {
          if (watchdogTimedOut) {
            if (accumulated.length > 0) handlers.onDone?.(accumulated);
            handlers.onError?.(
              '응답이 오래 걸려 자동으로 끊었어요. 받은 내용까지는 살려뒀으니, 이어쓰기 버튼을 눌러 마저 받아보세요.',
            );
          } else {
            console.log('[useChatStream] 사용자에 의해 스트리밍이 중단되었습니다.');
            if (accumulated.length > 0) handlers.onDone?.(accumulated);
          }
        } else {
          console.error('[useChatStream]', err);
          handlers.onError?.('서버 상태가 불안정합니다. 잠시 후 다시 시도해주세요.');
          if (accumulated.length > 0) handlers.onDone?.(accumulated); 
        }
      } finally {
        if (watchdogId) clearTimeout(watchdogId); 
        if (contentWatchdogId) clearTimeout(contentWatchdogId); 
        safeSetIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [safeSetIsStreaming, safeSetAiStatus],
  );

  return { stream, stop, isStreaming, aiStatus, setAiStatus: safeSetAiStatus };
}
