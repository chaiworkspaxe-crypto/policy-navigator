// components/MarkdownMessage.tsx
import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  MARKDOWN_COMPONENTS,
  MARKDOWN_REMARK_PLUGINS,
  MARKDOWN_REHYPE_PLUGINS,
} from './markdownConfig';

export default memo(function MarkdownMessage({ content }: { content: string }) {
  // 🌟 [핵심 방어막] content가 undefined이거나 null일 때 화면이 터지는 것을 방지!
  const safeContent = content || "";
  
  return (
    <ReactMarkdown
      remarkPlugins={MARKDOWN_REMARK_PLUGINS as any}
      rehypePlugins={MARKDOWN_REHYPE_PLUGINS as any}
      components={MARKDOWN_COMPONENTS}
    >
      {safeContent}
    </ReactMarkdown>
  );
});
