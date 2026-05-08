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
  onFirstDelta?: () => void;     // 🌟 첫 글자 수신 신호 (DB 저장 확신)
}

export function useChatStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [aiStatus, setAiStatus] = useState('');
  
  // 🌟 네트워크 요청을 강제로 끊을 수 있는 컨트롤러
  const abortControllerRef = useRef<AbortController | null>(null);

  // 🌟 답변 생성 중지 함수 (사용자 요청)
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

      // ==============================================================================
      // 🌟 [고도화 10] 무응답 Watchdog (감시견) 분리 및 타임아웃 추적
      // 첫 청크까지(connection): 60초 / 그 이후 청크 사이(idle): 45초
      // ==============================================================================
      let watchdogId: ReturnType<typeof setTimeout> | null = null;
      let isFirstChunk = true;
      let firstDeltaFired = false; 
      let watchdogTimedOut = false;  // 🌟 워치독 자동 abort 여부 추적 표식

      const CONNECT_TIMEOUT_MS = 60_000;
      const IDLE_TIMEOUT_MS = 45_000;

      const resetWatchdog = () => {
        if (watchdogId) clearTimeout(watchdogId);
        const ms = isFirstChunk ? CONNECT_TIMEOUT_MS : IDLE_TIMEOUT_MS;
        watchdogId = setTimeout(() => {
          console.warn(`[useChatStream] ${ms / 1000}초 응답 지연 — 자동 중단 발동 (firstChunk=${isFirstChunk})`);
          watchdogTimedOut = true;     // 🌟 시스템이 강제로 끊었음을 기록
          abortControllerRef.current?.abort();
        }, ms);
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
          
          isFirstChunk = false;        // 🌟 첫 청크 도착했으니 idle 타이머로 전환
          resetWatchdog();             // 🌟 데이터가 올 때마다 타이머 리셋

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? ''; // 마지막 부분 청크는 buffer에 남김

          for (const line of lines) {
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
              
              // 🌟 텍스트 스트리밍 중에는 상태 메시지를 숨김
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

        // 마지막 buffer 잔재 flush
        const tail = buffer.trim();
        if (tail) {
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
        if (err.name === 'AbortError') {
          // 🌟 [고도화 10] 시스템 자동 중단과 사용자 수동 중단을 분리해서 처리
          if (watchdogTimedOut) {
            handlers.onError?.(
              '응답이 오래 걸려 자동으로 끊었어요. 잠시 후 다시 시도해주세요. (네트워크 상태나 검색 양 때문일 수 있어요!)',
            );
          } else {
            console.log('[useChatStream] 사용자에 의해 스트리밍이 중단되었습니다.');
          }
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
