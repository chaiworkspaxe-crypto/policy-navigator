// components/AssistantBubble.tsx
'use client';
import { memo, useEffect, useState, useRef } from 'react';
import MarkdownMessage from './MarkdownMessage';

interface Props {
  content: string;
  isStreaming: boolean;
}

export default memo(function AssistantBubble({ content, isStreaming }: Props) {
  // 🛡️ [핵심] 훅은 무조건 컴포넌트 최상단에서 호출 (Rules of Hooks 준수!)
  const [renderedContent, setRenderedContent] = useState(content);
  const rafRef = useRef<number | null>(null);
  const lastFlushRef = useRef<number>(0);

  useEffect(() => {
    // 🌟 스트리밍 중이 아닐 땐 즉시 동기화하여 throttle 우회
    if (!isStreaming) {
      setRenderedContent(content);
      return;
    }

    const FLUSH_INTERVAL_MS = 80;
    const now = performance.now();
    const elapsed = now - lastFlushRef.current;

    if (elapsed >= FLUSH_INTERVAL_MS) {
      lastFlushRef.current = now;
      setRenderedContent(content);
    } else {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        lastFlushRef.current = performance.now();
        setRenderedContent(content);
        rafRef.current = null;
      });
    }

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [content, isStreaming]); // 의존성 배열에 isStreaming 추가

  // 🛡️ 스트리밍 마지막 청크가 throttle에 걸려 누락되는 걸 막기 위해,
  // 완료 직후 강제 동기화(setRenderedContent)도 useEffect가 책임집니다. 별도 early return 불필요.
  return <MarkdownMessage content={renderedContent} />;
});
