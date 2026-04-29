from functools import lru_cache
import os
import re
import urllib.request
import urllib.parse
import json
import asyncio 
import traceback
import hashlib
import logging
import pytz
from datetime import datetime
from contextlib import asynccontextmanager
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import redis.asyncio as aioredis 
import sentry_sdk 

try:
    import truststore
    truststore.inject_into_ssl()
except Exception:
    pass

from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.tools import tool

from chat_db import search_policies 

@tool
def get_current_time() -> str:
    """현재 날짜와 시간을 확인합니다."""
    return datetime.now(pytz.timezone('Asia/Seoul')).strftime("%Y년 %m월 %d일")

@tool
def search_internal_db(query: str) -> str:
    """사용자 질문을 바탕으로 내부 DB에서 정책을 검색합니다."""
    try:
        embeddings = OpenAIEmbeddings(model="text-embedding-3-small")
        query_vector = embeddings.embed_query(query)
        
        results = search_policies(query_vector)
        
        if not results:
            return "내부 DB에서 일치하는 정책을 찾지 못했습니다. naver_web_search를 사용하세요."
            
        if isinstance(results, list):
            formatted_results = []
            for p in results:
                title = p.get('title', '이름 없음')
                provider = p.get('provider', '주관기관 없음')
                summary = p.get('summary', '내용 없음')
                url = p.get('url', '링크 없음')
                formatted_results.append(f"- 정책명: {title} ({provider})\n  내용: {summary}\n  링크: {url}")
            return "\n\n".join(formatted_results)
            
        return str(results)
        
    except Exception as e:
        return f"DB 검색 중 오류 발생: {e}"

@tool
def naver_web_search(query: str) -> str:
    """지자체 블로그, 최신 뉴스, 지역구 특화 정보를 찾을 때 사용하는 필수 도구입니다."""
    client_id = os.getenv("NAVER_CLIENT_ID", "").strip()
    client_secret = os.getenv("NAVER_CLIENT_SECRET", "").strip()
    
    if not client_id or not client_secret:
        return "네이버 API 키 누락. global_web_search를 사용하세요."

    url = f"https://openapi.naver.com/v1/search/webkr?query={urllib.parse.quote(query)}&display=5"
    request = urllib.request.Request(url)
    request.add_header("X-Naver-Client-Id", client_id)
    request.add_header("X-Naver-Client-Secret", client_secret)
    
    try:
        response = urllib.request.urlopen(request)
        if response.getcode() == 200:
            data = json.loads(response.read().decode('utf-8'))
            results = []
            for item in data.get('items', []):
                clean_title = item['title'].replace('<b>', '').replace('</b>', '')
                clean_desc = item['description'].replace('<b>', '').replace('</b>', '')
                results.append(f"- 제목: {clean_title}\n  내용: {clean_desc}\n  링크: {item['link']}")
            return "\n".join(results) if results else "네이버 검색 결과 없음."
        return "네이버 검색 실패"
    except Exception as e:
        return f"네이버 검색 오류: {e}"

@tool
def global_web_search(query: str) -> str:
    """네이버 검색에서 찾지 못한 대한민국 정부 공식 문서, 지원 자격, 또는 '2026년 최신 신청 일정(마감일)'을 심층 교차 검증할 때 사용합니다."""
    
    # 💡 AI가 의도한 query(검색어)를 그대로 살리되, 최신성을 위해 '2026년'과 '대한민국'만 살짝 얹어줌!
    # (예: AI가 마감일이 궁금하면 query로 "청년월세지원 마감일"을 보낼 것이고, 자격이 궁금하면 "청년월세지원 소득조건"을 보낼 것임)
    localized_query = f"2026년 대한민국 {query}"
    
    try:
        from langchain_community.tools import DuckDuckGoSearchResults
        
        # 1순위: 덕덕고(DDG) 선봉대 출동! (비용 0원)
        search = DuckDuckGoSearchResults(backend="web", region="kr-kr", max_results=5)
        ddg_result = search.invoke(localized_query)
        
        if not ddg_result or "No good DuckDuckGo Search Result" in ddg_result:
            raise Exception("덕덕고 검색 결과 없음")
            
        return ddg_result
        
    except Exception as e:
        print(f"⚠️ 덕덕고 실패/결과없음 ({e}). 타빌리(Tavily)로 백업 검색 시도.")
        try:
            from langchain_community.tools.tavily_search import TavilySearchResults
            
            # 2순위: 비장의 무기 타빌리 출동! (비용 절약을 위해 max_results=3)
            tavily_search = TavilySearchResults(max_results=3)
            return tavily_search.invoke(localized_query)
            
        except Exception:
            return "글로벌 검색 엔진이 모두 차단되었습니다. 현재 지식과 DB 정보만으로 최선을 다해 답변하세요."

SYSTEM_PROMPT = """
당신은 대한민국 국민 모두의 '정보 비대칭'을 완벽하게 해소해 주는 최고의 '전국민 맞춤형 복지/지원금 내비게이터(Universal Policy Navigator)'입니다.
청년, 중장년, 노년층, 신혼부부, 육아 가구 등 어떤 사용자가 오더라도 그 사람의 조건에 딱 맞는 혜택을 찾아주어야 합니다.
사용자에게 따뜻하고 친절한 어조로 대화하되, 제공하는 정보는 관공서 수준으로 정확하고 엄격하게 검증되어야 합니다.

[🚀 무조건 지켜야 할 검색 및 행동 강령]
0. [가장 중요] 현재 시간 파악 및 안내:
   - 답변을 생성하기 전, 반드시 `get_current_time` 도구를 호출하여 오늘이 몇 년 몇 월 며칠인지 확인하세요.
   - 첫 인사말에 "안녕하십니까, 정책 내비게이터입니다. OOOO년 O월 O일 기준으로 신청 가능한 혜택을 컨설팅해 드립니다." 명시.

0.5. [매우 중요] 응답 시작 패턴 — 도구 호출 전 반드시 다음을 먼저 스트리밍:
   1) 한 줄 인사 ("OOOO년 O월 O일 기준으로 찾아드릴게요!")
   2) 검색 계획 안내 ("거주지 ___, 출생연도 ___을 토대로 다음 분야들을 한 번에 살펴볼게요:
      💼 일자리 / 🏠 주거·금융 / 📚 교육·문화 / ❤️ 복지·건강 / 👶 양육·돌봄"/ 등)
   3) 그 다음에 도구 호출 시작
   
   
1. 프로필 활용 — "답하면서 묻기" 패턴:
   - 거주지·출생연도는 이미 입력 폼으로 받았습니다. 추가 자격 조건(가구/주거/취업)이 부족해도 검색을 보류하지 마세요.
   - 일단 누구나 받을 수 있는 정책 + 거주지 기반 정책부터 안내하면서, 답변 끝에 핵심 자격 정보 1~2개를 자연스럽게 물어보세요.
   - 질문은 카톡 친구 톤으로 부드럽게. 코드 블록이나 강제 박스는 절대 사용 금지.
   - 좋은 예: "혹시 지금 무주택이신가요? 무주택자만 받을 수 있는 좋은 혜택이 몇 개 더 있어서요 :)"
   - 나쁜 예: "검색을 위해 다음 정보가 필요합니다: 1. 주거 형태 2. 직업 ..."
   
   (출력 예시)
   ### 🚨 잠깐! 더 정확한 혜택 조회를 위해 정보가 필요해요!
   ```text
   1. 거주하시는 '시/군/구' (예: 서울시 강남구, 부산시 해운대구)
   2. 정확한 '나이' (예: 25세)
   
   위 두 가지 정보를 채팅창에 입력해 주시면, 놓치고 있던 숨은 지원금을 싹 찾아드릴게요!
   
2. 🔍 다중 도구 병렬 탐색 (Stopping is Forbidden):
   - 내부 DB(`search_internal_db`)에 결과가 있더라도 절대 거기서 탐색을 멈추지 마세요.
   - 사용자의 구체적인 '시/군/구/동' 단위의 지자체 특화 혜택과 실시간 민간 지원금은 웹 검색(`naver_web_search`)에 훨씬 더 많습니다.
   - 반드시 2개 이상의 도구를 조합하여 정보의 양과 질을 극대화하세요. 정보량이 곧 당신의 실력입니다.

3. 🚦 탐색 전략 (Multi-Step Retrieval):
   - 1단계: `search_internal_db`로 정부 공식 정책의 뼈대를 빠르게 확보합니다.
   - 2단계: `naver_web_search`를 통해 사용자의 거주지(예: 화성시, 압구정동 등)와 직업적 특성에 맞는 '동네 전용 혜택'을 무조건 검색합니다.
   - 3단계: 1, 2단계에서 정보가 부족할 경우에만 `global_web_search`를 활용하여 정부 공식 문서를 교차 검증합니다.
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
   - 반드시 `naver_web_search` 또는 `global_web_search` 도구를 즉시 호출하여 "2026년 [해당 정책명] 신청기간"을 집요하게 검색해서 팩트 체크하세요.
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
"""

@lru_cache(maxsize=1)
def create_agent_executor():
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY 환경변수가 비어 있습니다.")

    # 🌟 GPT-4o로 기본 모델 안정화
    model_name = os.getenv("OPENAI_MODEL", "gpt-5.4").strip() 
    
    # 🌟 예전의 빠르고 가벼운 도구 4대장 복구 완료!
    tools = [search_internal_db, naver_web_search, global_web_search, get_current_time]

    llm = ChatOpenAI(
        model=model_name, 
        temperature=0.1, 
        max_completion_tokens=8192, 
        streaming=True
    ).bind_tools(tools)
    
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
        max_iterations=20, 
        max_execution_time=400,
        early_stopping_method="force"
    )

async def get_ai_response_stream(agent_executor, messages: list):
    full_answer = ""
    async for event in agent_executor.astream_events({"messages": messages}, version="v1"):
        kind = event["event"]

        if kind == "on_chat_model_stream":
            chunk = event["data"]["chunk"]
            if chunk.content:
                full_answer += chunk.content
                yield json.dumps({'type': 'content', 'delta': chunk.content}, ensure_ascii=False)

        elif kind == "on_tool_start":
            tool_name = event["name"]
            
            if tool_name == "search_internal_db":
                friendly_msg = "정부 정책 창고 셔터 올리는 중! 먼지가 쫌 날려도(쿨럭) 싹 다 찾아올게요 😷💨"
            elif tool_name == "naver_web_search":
                friendly_msg = "동네방네 뿌려진 지자체 혜택 전단지 싹 다 긁어모으는 중! 🏃‍♂️💨🔥"
            elif tool_name == "global_web_search" or "tavily" in tool_name or "duckduckgo" in tool_name:
                friendly_msg = "국내 공식 정부 문서 풀스캔 중! 하나도 안 놓칠게요 🔎💻"
            elif tool_name == "get_current_time":
                friendly_msg = "이미 끝난 공고 주면 혼나니까! 실시간 마감일 깐깐하게 비교 중입니다 🗓️⏳"
            else:
                friendly_msg = "하나라도 더 찾아내려고 AI가 풀야근 중입니다! 쪼~금만 더 기다려주세요 😭🌙"

            yield json.dumps({'type': 'status', 'message': f"🔍 {friendly_msg}"}, ensure_ascii=False)

    yield json.dumps({'type': 'done', 'full_content': full_answer}, ensure_ascii=False)

def get_ai_response(agent_executor, messages: list) -> str:
    result = agent_executor.invoke({"messages": messages})
    return result.get("output", "결과를 정리하는 중에 오류가 발생했습니다.")
