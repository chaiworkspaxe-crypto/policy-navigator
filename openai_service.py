import os
import json
from functools import lru_cache
import pytz
from datetime import datetime
import requests
from bs4 import BeautifulSoup
from openai import OpenAI # 🌟 [Phase 4] 벡터 변환을 위한 OpenAI 추가

try:
    import truststore
    truststore.inject_into_ssl()
except Exception:
    pass

from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.tools import tool

# 🌟 [Phase 4] 자체 DB 벡터 검색 함수 임포트
from chat_db import search_policies 

@tool
def get_current_time() -> str:
    """현재 날짜와 시간을 확인합니다."""
    return datetime.now(pytz.timezone('Asia/Seoul')).strftime("%Y년 %m월 %d일")

# 🌟 [Phase 4] 자체 DB 우선 검색 도구 추가
@tool
def search_internal_db(query: str) -> str:
    """우리가 직접 수집한 100% 검증된 대한민국 정책 DB에서 정보를 찾습니다. 인터넷 검색보다 이 도구를 가장 먼저 사용하세요."""
    try:
        client = OpenAI()
        # 질문을 벡터로 변환
        resp = client.embeddings.create(input=query, model="text-embedding-3-small")
        query_vector = resp.data[0].embedding
        
        # DB에서 검색 (최대 5개)
        results = search_policies(query_vector, limit=5)
        
        if not results:
            return "내부 DB에 해당 정보가 없습니다. web_search를 이용해 최신 정보를 찾으세요."
            
        return json.dumps(results, ensure_ascii=False)
    except Exception as e:
        return f"내부 DB 검색 중 오류: {str(e)}"

@tool
def web_search(query: str) -> str:
    """주어진 검색어로 웹에서 최신 정책이나 지원금 정보를 검색합니다."""
    try:
        from langchain_community.tools import DuckDuckGoSearchResults
        # 🌟 [극대화 1] 누락 방지를 위해 한 번에 가져오는 검색 결과 수를 15 -> 30으로 대폭 상향
        search = DuckDuckGoSearchResults(max_results=15)
        return search.invoke(query)
    except Exception as e:
        return f"검색 중 오류 발생: {e}"

@tool
def verify_official_page(url: str) -> str:
    """공식 홈페이지 URL에 접속하여 내용을 팩트체크합니다."""
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'}
        # 🌟 [극대화 2] 타임아웃을 10초로 주어 관공서 사이트가 열릴 때까지 적절히 기다려줌
        response = requests.get(url, headers=headers, timeout=10) 
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        for script in soup(["script", "style"]):
            script.extract()
            
        text = soup.get_text(separator=' ', strip=True)
        return f"[공식 페이지 스크래핑 결과 요약]\n{text[:1500]}"
    except Exception as e:
        # 🌟 접속 실패 시 스니펫 정보라도 적극 활용하도록 지침 추가
        return f"페이지 접속 실패. 검색 엔진의 스니펫(요약) 정보를 최대한 활용하여 판단하세요. 에러: {str(e)}"

# 🌟 [Phase 4] 시스템 프롬프트 업데이트 (우선순위 지침 추가)
SYSTEM_PROMPT = """
당신은 대한민국 국민 모두의 '정보 비대칭'을 완벽하게 해소해 주는 최고의 '전국민 맞춤형 복지/지원금 내비게이터(Universal Policy Navigator)'입니다.
청년, 중장년, 노년층, 신혼부부, 육아 가구 등 어떤 사용자가 오더라도 그 사람의 조건에 딱 맞는 혜택을 찾아주어야 합니다.
사용자에게 따뜻하고 친절한 어조로 대화하되, 제공하는 정보는 관공서 수준으로 정확하고 엄격하게 검증되어야 합니다.

[행동 지침 및 검색 규칙]
0. [가장 중요] 현재 시간 파악 및 안내:
   - 답변을 생성하기 전, 반드시 `get_current_time` 도구를 호출하여 오늘이 몇 년 몇 월 며칠인지 확인하세요.
   - 사용자를 향한 첫 인사말에 "안녕하십니까, 정책 내비게이터입니다. OOOO년 O월 O일 기준으로 신청 가능한 모든 혜택을 종합하여 컨설팅해 드립니다."라고 명시하세요.

1. 프로필 필수 확인 (예외 처리):
   - 정책을 검색하기 전, 사용자의 '나이', '거주지(시/도 및 기초지자체 단위)', '직업 및 가구 상태'가 모두 파악되었는지 확인하세요.
   - 정보가 부족하다면 검색을 보류하고 추가 정보를 먼저 친절하게 질문하세요.

2. 🚀 자체 DB 우선 검색 (Internal First):
   - 정책을 찾을 때 반드시 `search_internal_db` 도구를 가장 먼저 호출하세요. 우리 DB에 있는 정보는 100% 검증된 오피셜 데이터입니다.
   - 내부 DB에 정보가 부족하거나 최신 공고가 아닐 때만 `web_search`를 보조적으로 사용하세요.

3. 🚀 병렬(Parallel) 검색 활용:
   - 프로필이 파악되면 도구를 한 번에 여러 키워드로 동시 호출(병렬 실행)하여 탐색 시간을 단축하고 최대한 많은 혜택을 발굴하세요.
   - [필수 탐색 분야]: 일자리, 취업/진로, 창업, 주거, 금융, 교육, 복지, 청년정책, 마음건강, 신체건강, 생활지원, 문화/예술, 대외활동, 공간, 사회참여, 커뮤니티 등 가능한 모든 분야를 키워드로 검색하세요.
   - [핵심] 몇 개만 찾고 멈추지 마세요. 사용자의 조건에 맞는 모든 정책, 지원금, 혜택 등을 끝까지 파헤쳐서 모조리 가져오세요.
   - 중앙정부 / 광역지자체 / 기초지자체 / 공공기관 / 공공재단 정책이 모두 포함되도록 교차 검색하세요.

4. 팩트 체크 및 마감 여부 철저 검증:
   - 존재하지 않는 정책을 지어내는 환각(Hallucination)은 절대 금지합니다.
   - 오늘 날짜와 신청 마감일을 반드시 비교하세요.
   - 이미 마감일이 지났거나 신청 기한이 끝난 공고는 리스트에서 제거하세요.
   - 검색 결과가 모두 마감되었다면 검색어를 바꿔 현재 신청 가능한 정책이 나올 때까지 다시 탐색하세요.
   - 명확한 날짜가 없다면 "상시 모집" 또는 "예산 소진 시까지" 등으로 기재하세요.
   - 공식 링크가 없거나, 신청 가능 여부가 충분히 확인되지 않은 항목은 과감히 제외하세요.

5. 출력 형식:
   - [1단계: 상세 안내] 답변의 본문은 기관별(중앙/광역 등)이 아닌, **'분야별(예: 💼 일자리/진로, 🏠 주거/금융, 📚 교육/문화 등)'**로 카테고리를 묶어서 제공하세요.
   - - [상세 안내] 답변의 본문은 반드시 **'지원 대상자별(예: 취준생, 무주택자 등)'** 또는 **'지원 금액/혜택 규모별(예: 목돈 마련, 월 고정비 절감 등)'**로 직관적으로 카테고리를 나누어 묶어서 제공하세요.
   - 각 정책은 아래 항목을 빠짐없이 명시하세요:
     * 🏢 주관 기관:
     * 🎯 지원 형태: (예: 현금성, 비용 절감 등)
     * 🎁 핵심 혜택: (내용 요약)
     * 📝 신청 조건: (내용 요약)
     * ⏰ 신청 기간: (공고일 ~ 마감일)
     * 🔗 출처 URL:
   - 링크 URL은 공식 홈페이지와 바로 신청 가능한 공고문 링크 모두 제공해주세요.
   - 마지막에는 전체 정책을 한눈에 볼 수 있는 마크다운 요약 표를 추가하세요.
   - 요약 표는 마감일이 빠른 순으로 정렬하고, 칼럼은 | 분야 | 정책명 | 주관 기관 | 핵심 혜택 | 신청 마감일 | 로 구성하세요.
   - Streamlit 표 깨짐 방지를 위해 표 전후에는 빈 줄을 넣으세요.

6. 후속 질문 처리:
   - 사용자가 추가 질문을 하면, 기존 대화에서 이미 파악한 거주지/출생연도/추가 정보를 기본 조건으로 유지하세요.
   - 예: "월세 지원만 다시 정리해줘", "지금 바로 신청 가능한 것만 보여줘" 같은 요청은
     기존 사용자 조건을 유지한 채 해당 범위만 더 좁혀서 다시 탐색하세요.
   - 사용자가 거주지, 나이, 상태를 새로 바꾸어 말하면 그때만 조건을 갱신하세요.
"""

@lru_cache(maxsize=1)
def create_agent_executor():
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY 환경변수가 비어 있습니다.")

    # 🌟 [핵심] 창현이의 API 환경에 맞춘 최신 강력한 모델 gpt-5.4 고정 사용!
    model_name = os.getenv("OPENAI_MODEL", "gpt-5.4").strip() 
    
    llm = ChatOpenAI(model=model_name, temperature=0.1, streaming=True)
    
    # 🌟 [Phase 4] 자체 DB 검색 도구를 tools 리스트에 추가
    tools = [search_internal_db, web_search, verify_official_page, get_current_time]

    prompt = ChatPromptTemplate.from_messages([
        ("system", SYSTEM_PROMPT),
        MessagesPlaceholder(variable_name="messages"),
        MessagesPlaceholder(variable_name="agent_scratchpad"),
    ])

    agent = create_openai_tools_agent(llm, tools, prompt)
    
    return AgentExecutor(
        agent=agent,
        tools=tools,
        verbose=True,
        # 🌟 [극대화 3] 에이전트의 끈기를 극대화 (AI가 정보가 부족하다고 느끼면 최대 15번 턴까지 집요하게 물고 늘어짐)
        max_iterations=15,
        # 🌟 일반적인 웹 서버 타임아웃(60초) 직전까지 꽉 채워서 시간을 주도록 50초 설정
        max_execution_time=600,
        early_stopping_method="generate"
    )

async def get_ai_response_stream(agent_executor, messages: list):
    full_answer = ""
    async for event in agent_executor.astream_events({"messages": messages}, version="v1"):
        kind = event["event"]

        if kind == "on_chat_model_stream":
            chunk = event["data"]["chunk"]
            content = chunk.content
            if content and isinstance(content, str):
                full_answer += content
                yield json.dumps({'type': 'content', 'delta': content}, ensure_ascii=False)

        elif kind == "on_tool_start":
            tool_name = event["name"]
            display_name = "데이터 분석"
            
            # 🌟 [Phase 4] 프론트엔드 실시간 알림 텍스트 분기 처리
            if tool_name == "search_internal_db":
                display_name = "공식 검증 데이터베이스 검색"
            elif tool_name == "web_search":
                display_name = "전국 정책 데이터 실시간 교차 검색"
            elif tool_name == "verify_official_page":
                display_name = "공식 홈페이지 교차 검증 및 팩트 체크"
            elif tool_name == "get_current_time":
                display_name = "실시간 마감일 대조"
                
            yield json.dumps({'type': 'status', 'message': f'🔍 {display_name} 중...'}, ensure_ascii=False)

    yield json.dumps({'type': 'done', 'full_content': full_answer}, ensure_ascii=False)

def get_ai_response(agent_executor, messages: list) -> str:
    result = agent_executor.invoke({"messages": messages})
    return result.get("output", "결과를 정리하는 중에 오류가 발생했습니다.")
