// components/AssistantBubble.tsx
'use client';
import { memo, useEffect, useState, useRef } from 'react';
import MarkdownMessage from './MarkdownMessage';

interface Props {
  content: string;
  isStreaming: boolean;
}

export default memo(function AssistantBubble({ content, isStreaming }: Props) {
  // 🌟 스트리밍 중이 아니면 렌더링 지연(Throttle) 없이 즉시 MarkdownMessage로 넘김!
  // (중복 코드가 완전히 사라지고 재사용성 극대화)
  if (!isStreaming) return <MarkdownMessage content={content} />;
  
  const [renderedContent, setRenderedContent] = useState(content);
  const rafRef = useRef<number | null>(null);
  const lastFlushRef = useRef<number>(0);
  
  useEffect(() => {
    // 모바일 기기에서도 버벅임 없이 스트리밍 텍스트를 부드럽게 그리기 위한 최적화 로직
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
  }, [content]);
  
  return <MarkdownMessage content={renderedContent} />;
});
