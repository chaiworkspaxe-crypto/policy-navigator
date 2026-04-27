import { openai } from '@ai-sdk/openai';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

// 1. API 클라이언트 초기화
const rawOpenai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// ⚡️ Edge 런타임을 사용하여 파이썬 서버보다 응답 속도를 극대화!
export const runtime = 'edge';

const SYSTEM_PROMPT = `
당신은 대한민국 국민 모두의 '정보 비대칭'을 완벽하게 해소해 주는 최고의 '전국민 맞춤형 복지/지원금 내비게이터(Universal Policy Navigator)'입니다.
청년, 중장년, 노년층, 신혼부부, 육아 가구 등 어떤 사용자가 오더라도 그 사람의 조건에 딱 맞는 혜택을 찾아주어야 합니다.
사용자에게 따뜻하고 친절한 어조로 대화하되, 제공하는 정보는 관공서 수준으로 정확하고 엄격하게 검증되어야 합니다.

[🚀 무조건 지켜야 할 검색 및 행동 강령]
0. [가장 중요] 현재 시간 파악 및 안내:
   - 답변을 생성하기 전, 반드시 \`get_current_time\` 도구를 호출하여 오늘이 몇 년 몇 월 며칠인지 확인하세요.
   - 첫 인사말에 "안녕하십니까, 정책 내비게이터입니다. OOOO년 O월 O일 기준으로 신청 가능한 혜택을 컨설팅해 드립니다." 명시.
   
1. 프로필 필수 확인 (예외 처리):
   - 정책을 검색하기 전, 사용자의 '나이', '거주지(시/도 및 기초지자체 단위)', '직업 및 가구 상태'가 모두 파악되었는지 확인하세요.
   - 정보가 부족하다면 검색을 보류하고 추가 정보를 먼저 친절하게 질문하세요.
   - 🚨 [가장 중요] 누락된 정보를 요청할 때는 사용자가 무조건 시선을 멈추도록, 반드시 마크다운 헤더(\`###\`)와 코드 블록(\`\`\`)을 사용하여 시각적으로 거대한 박스를 만드세요! HTML 태그는 절대 사용하지 마세요.
   
   (출력 예시)
   ### 🚨 잠깐! 더 정확한 혜택 조회를 위해 정보가 필요해요!
   \`\`\`text
   1. 거주하시는 '시/군/구' (예: 서울시 강남구, 부산시 해운대구)
   2. 정확한 '나이' (예: 25세)
   
   위 두 가지 정보를 채팅창에 입력해 주시면, 놓치고 있던 숨은 지원금을 싹 찾아드릴게요!
   \`\`\`
   
2. 🔍 다중 도구 병렬 탐색 (Stopping is Forbidden):
   - 내부 DB(\`search_internal_db\`)에 결과가 있더라도 절대 거기서 탐색을 멈추지 마세요.
   - 사용자의 구체적인 '시/군/구/동' 단위의 지자체 특화 혜택과 실시간 민간 지원금은 웹 검색(\`naver_web_search\`)에 훨씬 더 많습니다.
   - 반드시 2개 이상의 도구를 조합하여 정보의 양과 질을 극대화하세요. 정보량이 곧 당신의 실력입니다.

3. 🚦 탐색 전략 (Multi-Step Retrieval):
   - 1단계: \`search_internal_db\`로 정부 공식 정책의 뼈대를 빠르게 확보합니다.
   - 2단계: \`naver_web_search\`를 통해 사용자의 거주지(예: 화성시, 압구정동 등)와 직업적 특성에 맞는 '동네 전용 혜택'을 무조건 검색합니다.
   - 3단계: 1, 2단계에서 정보가 부족할 경우에만 \`global_web_search\`를 활용하여 정부 공식 문서를 교차 검증합니다.
   - 🚨 절대 여러 도구를 한 번에 병렬로 동시 호출하지 마세요. 반드시 순서대로 하나씩 확인하세요.
   
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
    // 🤖 1. 에이전트 실행 (파이썬의 AgentExecutor 완벽 대체)
    // ==============================================================================
    const result = await streamText({
      model: openai('gpt-5.4'), // ✅ 모델명 수정됨 (gpt-5.4 -> gpt-4o)
      system: SYSTEM_PROMPT,
      messages,
      maxSteps: 10,
      tools: {
        get_current_time: tool({
          description: '현재 날짜와 시간을 확인합니다.',
          parameters: z.object({}),
          execute: async () => {
            return new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
          },
        }),
        search_internal_db: tool({
          description: '사용자 질문을 바탕으로 내부 DB에서 정부 정책을 검색합니다.',
          parameters: z.object({ query: z.string() }),
          execute: async ({ query }) => {
            const embeddingResponse = await rawOpenai.embeddings.create({
              model: 'text-embedding-3-small',
              input: query,
            });
            const { data, error } = await supabase.rpc('match_policies', {
              query_embedding: embeddingResponse.data[0].embedding,
              match_threshold: 0.3,
              match_count: 5,
            });

            if (error || !data || data.length === 0) {
              return "내부 DB에서 일치하는 정책을 찾지 못했습니다. naver_web_search를 사용하세요.";
            }
            return data.map((p: any) => `- 정책명: ${p.title} (${p.provider})\n  내용: ${p.summary}\n  링크: ${p.url}`).join('\n\n');
          },
        }),
        naver_web_search: tool({
          description: '지자체 블로그, 최신 뉴스, 지역구 특화 정보를 찾을 때 사용하는 필수 도구입니다.',
          parameters: z.object({ query: z.string() }),
          execute: async ({ query }) => {
            const clientId = process.env.NAVER_CLIENT_ID;
            const clientSecret = process.env.NAVER_CLIENT_SECRET;
            if (!clientId || !clientSecret) return "네이버 API 키 누락. global_web_search를 사용하세요.";

            const res = await fetch(`https://openapi.naver.com/v1/search/webkr?query=${encodeURIComponent(query)}&display=5`, {
              headers: { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret }
            });
            const data = await res.json();
            if (!data.items || data.items.length === 0) return "네이버 검색 결과 없음.";

            return data.items.map((item: any) => {
              const cleanTitle = item.title.replace(/<[^>]+>/g, '');
              const cleanDesc = item.description.replace(/<[^>]+>/g, '');
              return `- 제목: ${cleanTitle}\n  내용: ${cleanDesc}\n  링크: ${item.link}`;
            }).join('\n\n');
          },
        }),
        global_web_search: tool({
          description: "네이버 검색에서 찾지 못한 정부 공식 문서나 '2026년 최신 신청 일정(마감일)'을 교차 검증할 때 사용합니다.",
          parameters: z.object({ query: z.string() }),
          execute: async ({ query }) => {
            const localizedQuery = `2026년 대한민국 ${query}`;
            const tavilyKey = process.env.TAVILY_API_KEY;
            if (!tavilyKey) return "글로벌 검색 엔진이 차단되었습니다. 현재 지식과 DB 정보만으로 최선을 다해 답변하세요.";

            const res = await fetch('https://api.tavily.com/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ api_key: tavilyKey, query: localizedQuery, max_results: 3 })
            });
            const data = await res.json();
            if (!data.results || data.results.length === 0) return "글로벌 검색 결과 없음.";

            return data.results.map((r: any) => `- 제목: ${r.title}\n  내용: ${r.content}\n  링크: ${r.url}`).join('\n\n');
          },
        }),
      },
      onFinish: async ({ text }) => {
        if (userId && threadId) {
          try {
            const lastUserMessage = messages[messages.length - 1].content;
            await supabase.from('chat_messages').insert({
              thread_id: threadId,
              user_id: userId,
              role: 'user',
              content: lastUserMessage
            });
            await supabase.from('chat_messages').insert({
              thread_id: threadId,
              user_id: userId,
              role: 'assistant',
              content: text
            });
          } catch (dbError) {
            console.error("DB 저장 중 에러 발생:", dbError);
          }
        }
      }
    }); // ✅ 괄호 닫기 수정 완료!

    // ==============================================================================
    // 🌟 [핵심 수술] 파이썬 프론트엔드와 100% 호환되는 커스텀 JSON 스트리밍 엔진
    // ==============================================================================
    let fullAnswer = "";
    const customStream = new ReadableStream({
      async start(controller) {
        for await (const part of result.fullStream) {
          if (part.type === 'tool-call') {
            const toolName = part.toolName;
            let friendlyMsg = "하나라도 더 찾아내려고 AI가 풀야근 중입니다! 쪼~금만 더 기다려주세요 😭🌙";
            
            if (toolName === "search_internal_db") friendlyMsg = "정부 정책 창고 셔터 올리는 중! 먼지가 쫌 날려도(쿨럭) 싹 다 찾아올게요 😷💨";
            else if (toolName === "naver_web_search") friendlyMsg = "동네방네 뿌려진 지자체 혜택 전단지 싹 다 긁어모으는 중! 🏃‍♂️💨🔥";
            else if (toolName === "global_web_search") friendlyMsg = "국내 공식 정부 문서 풀스캔 중! 하나도 안 놓칠게요 🔎💻";
            else if (toolName === "get_current_time") friendlyMsg = "이미 끝난 공고 주면 혼나니까! 실시간 마감일 깐깐하게 비교 중입니다 🗓️⏳";

            controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'status', message: `🔍 ${friendlyMsg}` }) + '\n'));
          } else if (part.type === 'text-delta') {
            fullAnswer += part.textDelta;
            controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'content', delta: part.textDelta }) + '\n'));
          }
        }
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'done', full_content: fullAnswer }) + '\n'));
        controller.close();
      }
    });

    return new Response(customStream, {
      headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' }
    });

  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: '서버 에러가 발생했습니다.' }), { status: 500 });
  }
}
