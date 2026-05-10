// components/markdownConfig.tsx
import React from 'react';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Components } from 'react-markdown';

// 🌟 [보안/XSS 방어] 기본 살균 스키마에 안전한 속성(className 등)만 추가 허용
const customSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // 모든 태그에서 className을 허용하여 우리가 정의한 Tailwind 스타일이 안 깨지게 보호
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className'],
  },
};

export const MARKDOWN_REMARK_PLUGINS = [remarkGfm] as const;
// 🌟 [핵심] raw HTML을 변환한 직후, 즉시 sanitize(살균)하여 악성 스크립트를 제거! 순서가 매우 중요함.
export const MARKDOWN_REHYPE_PLUGINS = [rehypeRaw, [rehypeSanitize, customSchema]] as const;

export const MARKDOWN_COMPONENTS: Components = {
  p: ({ node, ...props }) => <p className="mb-3 leading-relaxed" {...props} />,
  ul: ({ node, ...props }) => <ul className="list-disc pl-5 mb-4 space-y-1 marker:text-green-500" {...props} />,
  ol: ({ node, ...props }) => <ol className="list-decimal pl-5 mb-4 space-y-1 marker:text-green-500 font-semibold" {...props} />,
  li: ({ node, ...props }) => <li className="mb-1" {...props} />,
  h1: ({ node, ...props }) => <h1 className="text-2xl font-extrabold mb-4 mt-6 text-gray-900 dark:text-white" {...props} />,
  h2: ({ node, ...props }) => <h2 className="text-xl font-bold mb-3 mt-5 text-green-700 dark:text-green-400 border-b border-gray-200 dark:border-[#444] pb-2" {...props} />,
  h3: ({ node, ...props }) => <h3 className="text-lg font-bold mb-3 mt-4 text-gray-800 dark:text-gray-100" {...props} />,
  h4: ({ node, ...props }) => <h4 className="text-base font-bold mb-2 mt-4 text-gray-800 dark:text-gray-200" {...props} />,
  h5: ({ node, ...props }) => <h5 className="text-sm font-bold mb-2 mt-3 text-gray-800 dark:text-gray-300" {...props} />,
  strong: ({ node, ...props }) => <strong className="font-bold text-gray-900 dark:text-white" {...props} />,
  mark: ({ node, ...props }) => <mark className="bg-yellow-200 dark:bg-yellow-500/30 text-gray-900 dark:text-yellow-100 px-1 rounded font-bold" {...props} />,
  a: ({ node, ...props }) => <a className="text-blue-600 dark:text-blue-400 hover:underline break-all font-bold" target="_blank" rel="noopener noreferrer" {...props} />,
  hr: ({ node, ...props }) => <hr className="my-5 border-gray-300 dark:border-[#444]" {...props} />,
  table: ({ node, ...props }) => (
    <div className="overflow-x-auto mb-5 w-full rounded-xl border border-gray-300 dark:border-[#444] shadow-sm">
      <table className="min-w-full text-sm text-left" {...props} />
    </div>
  ),
  thead: ({ node, ...props }) => <thead className="bg-gray-100 dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300" {...props} />,
  th: ({ node, ...props }) => <th className="px-4 py-3 border-b border-gray-300 dark:border-[#444] font-bold whitespace-nowrap" {...props} />,
  td: ({ node, ...props }) => <td className="px-4 py-3 border-b border-gray-200 dark:border-[#444]" {...props} />,
  pre: ({ node, ...props }) => <pre className="bg-gray-100 dark:bg-[#2a2a2a] p-4 rounded-xl overflow-x-auto text-sm font-mono mb-4 border border-gray-200 dark:border-[#444]" {...props} />,
  code: ({ node, className, ...props }) => {
    const isInline = !className;
    return <code className={`${className || ''} ${isInline ? 'bg-gray-100 dark:bg-[#2a2a2a] text-pink-600 dark:text-pink-400 px-1.5 py-0.5 rounded text-sm font-mono font-bold' : ''}`} {...props} />
  },
  blockquote: ({ node, ...props }) => (
    <blockquote className="my-4 border-l-4 border-green-500 bg-gray-50 dark:bg-[#222] py-2 pl-4 pr-2 italic text-gray-600 dark:text-gray-400 rounded-r-lg" {...props} />
  ),
};
