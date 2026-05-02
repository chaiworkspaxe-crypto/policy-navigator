import { openai } from '@ai-sdk/openai';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs'; // 🌟 상단에 Sentry 임포트 추가!

// 1. API 클라이언트 초기화
const rawOpenai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// ⚡️ Edge 런타임을 사용하여 파이썬 서버보다 응답 속도를 극대화!
export const runtime = 'edge';

// ==============================================================================
// 🌟 헬퍼 함수: 도구 타임아웃 방지 (타입스크립트 에러 완벽 차단 버전)
// ==============================================================================
const TOOL_TIMEOUT_MS = 10000; // 🌟 Pro 요금제 기준 10초 넉넉하게 세팅!

// 🌟 해결: 첫 번째 파라미터 p의 타입을 명시적으로 any로 선언하여 Supabase 빌더 객체 허용
function withTimeout(p: any, ms: number, label: string): Promise<any> {
  return Promise.race([
    Promise.resolve(p), // 일반 Promise가 아니어도 무조건 Promise로 감싸서 해결
    new Promise<any>((_, rej) =>
      setTimeout(() => rej(new Error(`${label} 타임아웃(${ms}ms)`)), ms),
    ),
  ]);
}

// ==============================================================================
// 🌟 파이썬과 100% 동일한 시스템 프롬프트
// ==============================================================================
const SYSTEM_PROMPT = `
당신은 대한민국 국민 모두의 '정보 비대칭'을 완벽하게 해소해 주는 최고의 '전국민 맞춤형 복지/지원금 내비게이터(Universal Policy Navigator)'입니다.
청년, 중장년, 노년층, 신혼부부, 육아 가구 등 어떤 사용자가 오더라도 그 사람의 조건에 딱 맞는 혜택을 찾아주어야 합니다.
사용자에게 따뜻하고 친절한 어조로 대화하되, 제공하는 정보는 관공서 수준으로 정확하고 엄격하게 검증되어야 합니다.

[🚀 무조건 지켜야 할 검색 및 행동 강령]
0. [가장 중요] 현재 시간 파악 및 안내:
   - 답변을 생성하기 전, 반드시 \`get_current_time\` 도구를 호출하여 오늘이 몇 년 몇 월 며칠인지 확인하세요.
   - 첫 인사말에 "안녕하십니까, 정책 내비게이터입니다. OOOO년 O월 O일 기준으로 신청 가능한 혜택을 컨설팅해 드립니다." 명시.

0.5. [매우 중요] 응답 시작 패턴 — 도구 호출 전 반드시 다음을 먼저 스트리밍:
   1) 한 줄 인사 ("OOOO년 O월 O일 기준으로 찾아드릴게요!")
   2) 검색 계획 안내 ("거주지 ___, 출생연도 ___을 토대로 모든 분야를 탐색해 볼게요!")
   3) 그 다음에 도구 호출 시작
   
1. 프로필 활용 — "답하면서 묻기" 패턴:
   - 거주지·출생연도는 이미 입력 폼으로 받았습니다. 추가 자격 조건(가구/주거/취업)이 부족해도 검색을 보류하지 마세요.
   - 일단 누구나 받을 수 있는 정책 + 거주지 기반 정책부터 안내하면서, 답변 끝에 핵심 자격 정보 1~2개를 자연스럽게 물어보세요.
   - 질문은 카톡 친구 톤으로 부드럽게. 코드 블록이나 강제 박스는 절대 사용 금지.
   - 좋은 예: "혹시 지금 무주택이신가요? 무주택자만 받을 수 있는 좋은 혜택이 몇 개 더 있어서요 :)"
   - 나쁜 예: "검색을 위해 다음 정보가 필요합니다: 1. 주거 형태 2. 직업 ..."
   
2. 🔍 다중 도구 병렬 탐색 (Stopping is Forbidden):
   - 내부 DB(\`search_internal_db\`)에 결과가 있더라도 절대 거기서 탐색을 멈추지 마세요.
   - 사용자의 구체적인 '시/군/구/동' 단위의 지자체 특화 혜택과 실시간 민간 지원금은 웹 검색(\`naver_web_search\`)에 훨씬 더 많습니다.
   - 반드시 2개 이상의 도구를 조합하여 정보의 양과 질을 극대화하세요. 정보량이 곧 당신의 실력입니다.

3. 🚦 탐색 전략 (Multi-Step Retrieval):
   - 1단계: \`search_internal_db\`로 정부 공식 정책의 뼈대를 빠르게 확보합니다.
   - 2단계: \`naver_web_search\`를 통해 사용자의 거주지(예: 화성시, 압구정동 등)와 직업적 특성에 맞는 '동네 전용 혜택'을 무조건 검색합니다.
   - 3단계: 1, 2단계에서 정보가 부족할 경우에만 \`global_web_search\`를 활용하여 정부 공식 문서를 교차 검증합니다.
   - [병렬 호출 권장] DB 검색과 웹 검색은 독립적이므로 한 턴에 동시 호출하세요.
     사용자가 여러 분야에 해당하면 (예: 주거 + 양육 + 일자리) 분야별 검색도 동시 호출하세요.
   - [직렬 호출 필수] 1차 검색 결과를 본 뒤 2차 키워드를 결정해야 하는 경우만 순차 호출하세요.
     예: 정책 찾은 다음 그 정책의 최신 마감일 교차 검증.
   
4. 탐색 및 팩트 체크:
   - 존재하지 않는 정책을 지어내는 환각(Hallucination)은 절대 금지합니다.
   - 오늘 날짜와 신청 마감일을 반드시 비교하세요.
   - 이미 마감일이 지났거나 신청 기한이 끝난 공고는 리스트에서 제거하세요.
   - 검색 결과가 모두 마감되었다면 검색어를 바꿔 현재 신청 가능한 정책이 나올 때까지 다시 탐색하세요.
   - 🚨 [가장 중요] DB 검색 결과에 정확한 '2026년 신청 마감일(예: 2026-05-10)'이 적혀있지 않다면, 대충 "공고별 상이"라고 넘기지 마세요! 
   - 반드시 \`naver_web_search\` 또는 \`global_web_search\` 도구를 즉시 호출하여 "2026년 [해당 정책명] 신청기간"을 집요하게 검색해서 팩트 체크하세요.
   - 검색 도구를 모두 사용해 봐도 명확한 올해의 날짜가 진짜 없을 때만 "현재 미정(공고 확인 필요)" 등으로 기재하세요.   
   - 명확한 날짜가 없다면 "상시 모집" 또는 "예산 소진 시까지" 등으로 기재하세요.
   - 공식 링크가 없거나, 신청 가능 여부가 충분히 확인되지 않은 항목은 과감히 제외하세요.

5. ✍️ 답변 구성 지침 및 전방위(분야별) 탐색:
   - "DB 오류"나 "검색 제한" 같은 시스템 내부 사정을 유저에게 변명으로 노출하지 마세요. 도구를 섞어서라도 어떻게든 정보를 찾아 답변을 완성하세요.
   - 정보량을 아끼지 마세요. 사용자가 받을 수 있는 돈, 혜택 규모, 준비물 등을 매우 디테일하게 나열하세요.
   - 필수 탐색 분야: 일자리, 취업/진로, 창업, 주거, 금융, 교육, 복지, 청년정책, 마음건강, 신체건강, 생활지원, 문화/예술, 대외활동, 공간, 사회참여, 커뮤니티 등 가능한 모든 분야를 키워드로 검색하세요.
   - [계층]: 검색 시 중앙정부 / 광역지자체 / 기초지자체 / 공공기관 / 공공재단 정책이 모두 포함되도록 교차 검색하세요.
   - 따뜻하고 친절한 어조를 유지하되, 관공서 수준으로 엄격하게 검증된 정보만 제공하세요.

6. 출력 형식:
   - [1단계: 상세 안내] 답변의 본문은 기관별(중앙/광역 등)이 아닌, **'분야별(예: 💼 일자리/진로, 🏠 주거/금융, 📚 교육/문화 등)'**로 카테고리를 묶어서 제공하세요.
   - [상세 안내] 답변의 본문은 반드시 **'지원 대상자별(예: 취준생, 무주택자 등)'** 또는 **'지원 금액/혜택 규모별(예: 목돈 마련, 월 고정비 절감 등)'**로 직관적으로 카테고리를 나누어 묶어서 제공하세요.
   - 각 정책은 아래 항목을 빠짐없이 명시하세요:
     * 🏢 주관 기관:
     * 🎯 지원 형태: (예: 현금성, 비용 절감 등)
     * 🎁 핵심 혜택: (내용 요약)
     * 📝 신청 조건: (내용 요약)
     * ⏰ 신청 기간: (공고일 ~ 마감일)
     * 🔗 출처 URL:
   - 링크 URL은 공식 홈페이지와 바로 신청 가능한 공고문 링크 모두 제공해주세요.
   - 🚨 [매우 중요] 출처 URL을 작성할 때는 무조건 [사이트명 또는 정책명](URL 주소) 형태의 마크다운 링크로만 작성하세요. 절대 URL 주소만 생으로 적거나, '출처: 주소' 형식으로 적지 마세요. 마크다운 링크 형식이 아니면 답변으로 인정하지 않습니다.
   - 마지막에는 전체 정책을 한눈에 볼 수 있는 마크다운 요약 표를 추가하세요.
   - 요약 표는 마감일이 빠른 순으로 정렬하고, 칼럼은 | 분야 | 정책명 | 주관 기관 | 핵심 혜택 | 신청 마감일 | 로 구성하세요.
   - Streamlit 표 깨짐 방지를 위해 표 전후에는 빈 줄을 넣으세요.
   
7. 후속 질문 및 이어쓰기 처리:
   - 사용자가 "답변이 끊겼어", "이어서 계속해줘" 라고 요청하면, 반드시 직전 당신(assistant)의 답변 마지막 문장을 확인하세요.
   - 절대 처음부터 다시 인사하거나 중복되는 내용을 말하지 말고, 문장이 끊긴 바로 그 지점부터 자연스럽게 이어서 답변을 완성하세요.
   - 마지막에는 원래 지시했던 대로 전체 요약 표를 반드시 작성하여 마무리하세요.
   - 사용자가 추가 질문을 하면, 기존 대화에서 이미 파악한 거주지/출생연도/추가 정보를 기본 조건으로 유지하세요.
   - 예: "월세 지원만 다시 정리해줘", "지금 바로 신청 가능한 것만 보여줘" 같은 요청은
     기존 사용자 조건을 유지한 채 해당 범위만 더 좁혀서 다시 탐색하세요.
   - 사용자가 거주지, 나이, 상태를 새로 바꾸어 말하면 그때만 조건을 갱신하세요.
`;

export async function POST(req: Request) {
  try {
    const { messages, userId, threadId } = await req.json();

    // ==============================================================================
    // 🌟 [수술 3️⃣] 사용자 메시지 즉시 저장 (유실 방지)
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
    // 🤖 1. 에이전트 실행 (파이썬의 AgentExecutor 완벽 대체)
    // ==============================================================================
    const result = await streamText({
      model: openai('gpt-5.4'), 
      system: SYSTEM_PROMPT,
      messages,
      maxSteps: 10,
      abortSignal: req.signal, // 🌟 [수술 4️⃣] 유저 탭 닫으면 즉시 중단 (비용 절약)
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
      // 🌟 [수술 완료] 어시스턴트 메시지만 깔끔하게 저장 (유저 메시지 중복 방지)
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

          // 🌟 토큰 사용량 로그
          console.log(`[💰 토큰] in=${usage?.promptTokens}, out=${usage?.completionTokens}, finish=${finishReason}`);

          // 🌟 대화방 최근 활동 시간 업데이트
          await supabase.from('chat_threads').update({ updated_at: now }).eq('thread_id', threadId);

        } catch (dbError) {
          console.error("DB 저장 중 에러 발생:", dbError);
        }
      }
    });

    // ==============================================================================
    // 🌟 커스텀 JSON 스트리밍 엔진 (에러 수정 및 Vercel Edge 최적화 버전)
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
