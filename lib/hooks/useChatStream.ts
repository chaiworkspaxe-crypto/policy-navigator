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
  onDone?: (full: string, meta?: { truncated?: boolean; finishReason?: string }) => void;
  onFirstDelta?: () => void;     
}

export function useChatStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [aiStatus, setAiStatus] = useState('');
  
  const abortControllerRef = useRef<AbortController | null>(null);
  
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

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
      
      const NO_CONTENT_TIMEOUT_INITIAL_MS = 90_000;      
      const NO_CONTENT_EXTENSION_PER_STATUS_MS = 25_000; 
      const NO_CONTENT_HARD_CAP_MS = 240_000;            

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

      const scheduleContentWatchdog = () => {
        if (contentWatchdogId) clearTimeout(contentWatchdogId);
        const remaining = Math.max(0, contentWatchdogDeadline - Date.now());
        contentWatchdogId = setTimeout(() => {
          console.warn(`[useChatStream] content 워치독 발동 (소요시간: ${(Date.now() - streamStartedAt) / 1000}초)`);
          watchdogTimedOut = true;
          abortControllerRef.current?.abort();
        }, remaining);
      };

      const extendContentWatchdog = (extensionMs: number) => {
        const hardCap = streamStartedAt + NO_CONTENT_HARD_CAP_MS;
        const proposed = Date.now() + extensionMs;
        contentWatchdogDeadline = Math.min(proposed, hardCap);
        scheduleContentWatchdog();
      };

      const resetContentWatchdog = () => {
        contentWatchdogDeadline = Date.now() + NO_CONTENT_TIMEOUT_INITIAL_MS;
        scheduleContentWatchdog();
      };

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

        if (response.status === 429) {
          const errorData = await response.json().catch(() => ({}));
          if (isMountedRef.current) {
            handlers.onError?.(errorData.detail || '요청이 너무 많아요. 잠시 후 다시 시도해주세요.');
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
        resetContentWatchdog(); 

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
              resetContentWatchdog(); 
            } else if (data.type === 'status') {
              safeSetAiStatus(data.message);
              handlers.onStatus?.(data.message);
              
              extendContentWatchdog(NO_CONTENT_EXTENSION_PER_STATUS_MS);
              
            } else if (data.type === 'error') {
              handlers.onError?.(data.message);
            } else if (data.type === 'done') {
              handlers.onDone?.(data.full_content ?? accumulated, { 
                truncated: data.truncated === true,
                finishReason: data.finish_reason,
              });
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
              handlers.onDone?.(data.full_content ?? accumulated, {
                truncated: data.truncated === true,
                finishReason: data.finish_reason,
              });
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
