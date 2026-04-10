import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]} // 표(Table) 렌더링을 위해 필수
      components={{
        // 제목 (h1, h2, h3)
        h3: ({ node, ...props }) => <h3 className="mt-5 mb-2 text-lg font-bold text-green-400" {...props} />,
        h4: ({ node, ...props }) => <h4 className="mt-4 mb-2 text-base font-bold text-gray-100" {...props} />,
        
        // 일반 텍스트 및 문단
        p: ({ node, ...props }) => <p className="mb-4 leading-relaxed text-gray-200" {...props} />,
        
        // 🌟 강조 (Bold) - 눈에 확 띄게 처리
        strong: ({ node, ...props }) => <strong className="font-bold text-green-300 bg-green-900/20 px-1 rounded" {...props} />,
        
        // 리스트 (순서 없음, 순서 있음)
        ul: ({ node, ...props }) => <ul className="mb-4 list-outside list-disc pl-5 space-y-1 text-gray-200 marker:text-green-500" {...props} />,
        ol: ({ node, ...props }) => <ol className="mb-4 list-outside list-decimal pl-5 space-y-1 text-gray-200 marker:text-green-500" {...props} />,
        li: ({ node, ...props }) => <li className="pl-1" {...props} />,
        
        // 🌟 표 (Table) - 모바일에서 좌우 스크롤이 가능하도록 래핑
        table: ({ node, ...props }) => (
          <div className="my-4 w-full overflow-x-auto rounded-lg border border-[#444] bg-[#1a1a1a] shadow-sm">
            <table className="w-full min-w-[500px] text-left text-sm text-gray-300" {...props} />
          </div>
        ),
        th: ({ node, ...props }) => <th className="border-b border-[#444] bg-[#222] px-4 py-3 font-semibold text-gray-100" {...props} />,
        td: ({ node, ...props }) => <td className="border-b border-[#333] px-4 py-3 align-top leading-relaxed last:border-b-0" {...props} />,
        
        // 인용구 (Blockquote) - 요약 정보 등에 주로 쓰임
        blockquote: ({ node, ...props }) => (
          <blockquote className="my-4 border-l-4 border-green-500 bg-[#222] py-2 pl-4 pr-2 italic text-gray-400 rounded-r-lg" {...props} />
        ),
        
        // 링크
        a: ({ node, ...props }) => <a className="text-green-400 underline underline-offset-2 hover:text-green-300 transition" target="_blank" rel="noopener noreferrer" {...props} />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}