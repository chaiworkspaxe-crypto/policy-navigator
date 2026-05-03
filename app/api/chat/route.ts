import { openai } from '@ai-sdk/openai';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs'; 
import { POLICY_NAVIGATOR_SYSTEM_PROMPT } from '@/lib/prompts/policyNavigator';

// 1. API 클라이언트 초기화
const rawOpenai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// ⚡️ Edge 런타임을 사용하여 응답 속도를 극대화!
export const runtime = 'edge';

// ==============================================================================
// 🌟 헬퍼 함수: 도구 타임아웃 방지
// ==============================================================================
const TOOL_TIMEOUT_MS = 10000;

function withTimeout(p: any, ms: number, label: string): Promise<any> {
  return Promise.race([
    Promise.resolve(p), 
    new Promise<any>((_, rej) =>
      setTimeout(() => rej(new Error(`${label} 타임아웃(${ms}ms)`)), ms),
    ),
  ]);
}

export async function POST(req: Request) {
  try {
    const { messages, userId, threadId } = await req.json();

    // 🌟 서버사이드 절대경로 추출 (백그라운드 fetch용)
    const reqUrl = new URL(req.url);
    const extractApiUrl = `${reqUrl.origin}/api/profile/extract`;

    // ==============================================================================
    // 🌟 사용자 메시지 즉시 저장 (유실 방지)
    // ==============================================================================
    if (userId && threadId && Array.isArray(messages) && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === 'user') {
        const content = typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content);
        const now = new Date().toISOString();
        const { error: insertErr } = await supabase.from('chat_messages').insert({
          thread_id: threadId,
          user_id: userId,
          role: 'user',
          content,
          created_at: now,
          updated_at: now,
        });
        if (insertErr) console.error('[user msg insert]', insertErr);
      }
    }

    // ==============================================================================
    // 🌟 [수술 1️⃣1️⃣] 메인 응답 전, 기존 프로필 컨텍스트 주입 (AI 뇌에 장부 입력)
    // ==============================================================================
    let profileContext = '';
    if (userId && threadId) {
      const { data: inputs } = await supabase
        .from('chat_thread_inputs')
        .select('profile_json, selected_city, selected_district, birth_year, extra_info')
        .eq('thread_id', threadId)
        .eq('user_id', userId)
        .maybeSingle();

      if (inputs) {
        // 네가 작성한 깔끔한 포맷 적용!
        profileContext = `\n\n[현재까지 파악된 사용자 프로필]
- 거주지: ${inputs.selected_city ?? '미상'} ${inputs.selected_district ?? ''}
- 출생연도: ${inputs.birth_year ?? '미상'}
- 추가 정보: ${inputs.extra_info ?? '없음'}
- 백그라운드 추출: ${JSON.stringify(inputs.profile_json ?? {})}

이 프로필을 활용해 검색을 더 정밀하게 수행하세요. 이미 알고 있는 정보는 다시 묻지 마세요.`;
      }
    }

    // ==============================================================================
    // 🤖 1. 에이전트 실행
    // ==============================================================================
    const result = await streamText({
      model: openai('gpt-5.4'), 
      // 🌟 [수술 1️⃣1️⃣] 기존 프롬프트에 동적 프로필 컨텍스트(profileContext) 합체!
      system: POLICY_NAVIGATOR_SYSTEM_PROMPT + profileContext,
      messages,
      maxSteps: 10,
      abortSignal: req.signal, 
      onError: (err) => {
        console.error('[streamText onError]', err);
      },
      tools: {
        get_current_time: tool({
          description: '오늘 날짜와 시간(서울 기준)을 반환합니다.',
          parameters: z.object({}),
          execute: async () => {
            try {
              return new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
            } catch (e) {
              return '시간 조회 실패. UTC 기준으로 진행해주세요.';
            }
          },
        }),

        search_internal_db: tool({
          description: '내부 DB(pgvector)에서 정부 정책의 의미적 유사도 상위 결과를 가져옵니다. 가장 먼저 호출하세요.',
          parameters: z.object({ query: z.string().describe('한국어 자연어 검색어') }),
          execute: async ({ query }) => {
            try {
              const embeddingResponse = await withTimeout(
                rawOpenai.embeddings.create({ model: 'text-embedding-3-small', input: query }),
                TOOL_TIMEOUT_MS,
                'embedding',
              );

              for (const threshold of [0.55, 0.4]) {
                const { data, error } = await withTimeout(
                  supabase.rpc('match_policies', {
                    query_embedding: embeddingResponse.data[0].embedding,
                    match_threshold: threshold,
                    match_count: 8,
                  }),
                  TOOL_TIMEOUT_MS,
                  'pgvector',
                );

                if (error) {
                  console.error('[search_internal_db] supabase error:', error);
                  return `내부 DB 일시 장애 (${error.message}). naver_web_search로 우회하세요.`;
                }
                if (data && data.length > 0) {
                  return data
                    .map((p: any) => `- 정책명: ${p.title} (${p.provider})\n  내용: ${p.summary}\n  링크: ${p.url}`)
                    .join('\n\n');
                }
              }
              return '내부 DB에 매칭되는 정책 없음. naver_web_search 또는 global_web_search로 보완하세요.';
            } catch (e: any) {
              console.error('[search_internal_db] fatal:', e);
              return `내부 DB 검색 실패(${e?.message ?? 'unknown'}). naver_web_search로 즉시 우회하세요.`;
            }
          },
        }),

        naver_web_search: tool({
          description: '지자체/읍면동 단위 특화 정책, 최신 공고를 찾을 때 우선 사용. 키워드는 "OOO시 OOO 지원금" 형태가 효과적.',
          parameters: z.object({ query: z.string() }),
          execute: async ({ query }) => {
            try {
              const clientId = process.env.NAVER_CLIENT_ID;
              const clientSecret = process.env.NAVER_CLIENT_SECRET;
              if (!clientId || !clientSecret) {
                return '네이버 API 키 미설정. global_web_search를 사용하세요.';
              }
              const res = await withTimeout(
                fetch(
                  `https://openapi.naver.com/v1/search/webkr?query=${encodeURIComponent(query)}&display=5`,
                  { headers: { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret } },
                ),
                TOOL_TIMEOUT_MS,
                'naver',
              );
              if (!res.ok) {
                return `네이버 검색 ${res.status} 에러. global_web_search로 우회하세요.`;
              }
              const data = await res.json();
              if (!data.items?.length) {
                return '네이버 검색 결과 없음. 키워드를 더 구체적으로(지역명+분야) 바꿔 재시도해보세요.';
              }
              return data.items
                .map((item: any) => {
                  const cleanTitle = item.title.replace(/<[^>]+>/g, '');
                  const cleanDesc = item.description.replace(/<[^>]+>/g, '');
                  return `- 제목: ${cleanTitle}\n  내용: ${cleanDesc}\n  링크: ${item.link}`;
                })
                .join('\n\n');
            } catch (e: any) {
              console.error('[naver_web_search] fatal:', e);
              return `네이버 검색 실패(${e?.message ?? 'unknown'}). global_web_search로 우회하세요.`;
            }
          },
        }),

        global_web_search: tool({
          description: '정부 공식 문서 / 최신 신청 일정 교차 검증. 네이버에서 못 찾았거나 마감일 확인이 필요할 때 사용.',
          parameters: z.object({ query: z.string() }),
          execute: async ({ query }) => {
            try {
              const tavilyKey = process.env.TAVILY_API_KEY;
              if (!tavilyKey) {
                return '글로벌 검색 미설정. DB와 네이버 결과만으로 답변하세요.';
              }
              const seoulYear = new Intl.DateTimeFormat('en-US', {
                timeZone: 'Asia/Seoul',
                year: 'numeric',
              }).format(new Date());
              const localizedQuery = `${seoulYear}년 대한민국 ${query}`;

              const res = await withTimeout(
                fetch('https://api.tavily.com/search', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    api_key: tavilyKey,
                    query: localizedQuery,
                    max_results: 4,
                    search_depth: 'advanced',
                    include_domains: ['gov.kr', 'go.kr', 'or.kr', 'bokjiro.go.kr', 'youthcenter.go.kr'],
                  }),
                }),
                TOOL_TIMEOUT_MS + 2000,
                'tavily',
              );
              if (!res.ok) {
                return `글로벌 검색 ${res.status}. 네이버 결과만으로 답변하세요.`;
              }
              const data = await res.json();
              if (!data.results?.length) {
                return '글로벌 검색 결과 없음. 키워드를 바꿔 재시도하거나 보유 정보로 마무리하세요.';
              }
              return data.results
                .map((r: any) => `- 제목: ${r.title}\n  내용: ${r.content}\n  링크: ${r.url}`)
                .join('\n\n');
            } catch (e: any) {
              console.error('[global_web_search] fatal:', e);
              return `글로벌 검색 실패(${e?.message ?? 'unknown'}). 보유 정보로 답변하세요.`;
            }
          },
        }),
      },
      onFinish: async ({ text, usage, finishReason }) => {
        if (!userId || !threadId) return;
        try {
          const now = new Date().toISOString(); 
          
          await supabase.from('chat_messages').insert({
            thread_id: threadId,
            user_id: userId,
            role: 'assistant',
            content: text,
            created_at: now,
            updated_at: now 
          });

          console.log(`[💰 토큰] in=${usage?.promptTokens}, out=${usage?.completionTokens}, finish=${finishReason}`);
          await supabase.from('chat_threads').update({ updated_at: now }).eq('thread_id', threadId);

          // ==============================================================================
          // 🌟 [수술 1️⃣1️⃣] 백그라운드 프로필 추출 — fire-and-forget (응답 지연 없음)
          // ==============================================================================
          const lastUser = messages[messages.length - 1];
          if (lastUser?.role === 'user' && typeof lastUser.content === 'string') {
            // 메인 로직을 막지 않고(await 없음) 뒤에서 조용히 API 호출
            fetch(extractApiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId,
                threadId,
                lastUserMessage: lastUser.content,
              }),
            }).catch((e) => console.error('[bg extract fire-and-forget error]', e));
          }

        } catch (dbError) {
          console.error("DB 저장 중 에러 발생:", dbError);
        }
      }
    });

    // ==============================================================================
    // 🌟 커스텀 JSON 스트리밍 엔진
    // ==============================================================================
    let fullAnswer = "";
    let streamErrored = false;

    const customStream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (obj: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));

        try {
          for await (const part of result.fullStream) {
            switch (part.type) {
              case 'tool-call': {
                console.log(`[🤖 도구 호출] ${part.toolName}`, part.args);
                const friendlyMsg = pickFriendlyMessage(part.toolName, part.args);
                send({ type: 'status', message: `🔍 ${friendlyMsg}` });
                break;
              }
              case 'tool-result': {
                console.log(`[✅ 도구 응답] ${part.toolName} 완료`);
                break;
              }
              case 'text-delta': {
                fullAnswer += part.textDelta;
                send({ type: 'content', delta: part.textDelta });
                break;
              }
              case 'error': {
                streamErrored = true;
                const err = part.error as Error;
                console.error('\n[💥 모델 스트림 에러]', err);
                Sentry.captureException(err, { tags: { phase: 'model-stream' } });
                send({
                  type: 'error',
                  message: '앗, AI가 잠깐 어지러워해요 🥲 잠시 후 다시 시도해주세요. (자동으로 끊긴 답변 이어쓰기가 가능해요!)',
                });
                break;
              }
            }
          }
        } catch (loopErr) {
          streamErrored = true;
          console.error('\n[💀 스트림 루프 치명 에러]', loopErr);
          Sentry.captureException(loopErr);
          send({
            type: 'error',
            message: '서버가 잠시 흔들렸어요. 다시 한 일시적인 현상이니 한번 더 시도 부탁드릴게요 🙇‍♂️',
          });
        } finally {
          console.log(`\n[🏁 스트림 종료] 길이=${fullAnswer.length}, error=${streamErrored}`);
          send({ type: 'done', full_content: fullAnswer, errored: streamErrored });
          controller.close();
        }
      },
    });

    return new Response(customStream, {
      headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' }
    });

  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: '서버 에러가 발생했습니다.' }), { status: 500 });
  }
}

// ==============================================================================
// 🌟 파일 맨 아래에 헬퍼 함수 추가
// ==============================================================================
function pickFriendlyMessage(toolName: string, args: any): string {
  const argHint =
    typeof args?.query === 'string' && args.query.length > 0
      ? ` ("${args.query.slice(0, 18)}${args.query.length > 18 ? '…' : ''}")`
      : '';
      
  switch (toolName) {
    case 'search_internal_db':
      return `정부 정책 창고 셔터 올리는 중${argHint}! 먼지가 쫌 날려도(쿨럭) 싹 다 찾아올게요 😷💨`;
    case 'naver_web_search':
      return `동네방네 지자체 전단지 긁어모으는 중${argHint}! 🏃‍♂️💨🔥`;
    case 'global_web_search':
      return `정부 공식 문서 풀스캔 중${argHint}! 하나도 안 놓칠게요 🔎💻`;
    case 'get_current_time':
      return '실시간 마감일 깐깐 비교 중 🗓️⏳';
    default:
      return '하나라도 더 찾아내려고 AI가 풀야근 중! 쪼~금만 더 기다려주세요 😭🌙';
  }
}
