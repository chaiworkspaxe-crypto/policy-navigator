import os
import json
import asyncio
import traceback
import logging
from datetime import datetime
from celery import Celery
from dotenv import load_dotenv
from openai import OpenAI 
from supabase import create_client, Client

import redis.asyncio as aioredis 

# 기존 AI 서비스 및 DB 함수 임포트
from openai_service import create_agent_executor, get_ai_response_stream
from chat_db import save_chat_message, upsert_policy, load_thread_inputs

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] Worker: %(message)s")
logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL")

# Celery 전용 브로커 URL
CELERY_BROKER_URL = REDIS_URL
clean_base_url = REDIS_URL.split("?")[0] if REDIS_URL else ""
if clean_base_url.startswith("rediss://") and "ssl_cert_reqs" not in (REDIS_URL or ""):
    CELERY_BROKER_URL = clean_base_url + "?ssl_cert_reqs=CERT_NONE"

celery_app = Celery("policy_worker", broker=CELERY_BROKER_URL, backend=CELERY_BROKER_URL)
client = OpenAI()

# Supabase DB 연결 초기화
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# aioredis 안전한 연결
def get_async_redis_client():
    clean_url = REDIS_URL.split("?")[0] if REDIS_URL else ""
    if clean_url.startswith("rediss://"):
        return aioredis.from_url(clean_url, ssl_cert_reqs="none")
    return aioredis.from_url(clean_url)

# ==============================================================================
# [라이브 서비스] 유저가 검색을 누르면 실시간으로 돌아가는 기존 AI 에이전트
# ==============================================================================
async def run_agent_and_publish(thread_id: str, user_id: str, agent_messages: list, message_type: str):
    await asyncio.sleep(1.5)
    
    full_content = ""
    channel_name = f"chat_{thread_id}"
    async_redis = get_async_redis_client()
    
    try:
        logger.info(f"[{thread_id}] AI 정책 검색 시작")
        
        await async_redis.publish(
            channel_name, 
            json.dumps({'type': 'status', 'message': '🔍 조건에 맞는 맞춤형 혜택을 DB에서 선별 중입니다...'}, ensure_ascii=False)
        )
        
        agent_executor = create_agent_executor()
        gen = get_ai_response_stream(agent_executor, agent_messages)
        is_first_chunk = True
        
        async for chunk in gen:
            clean_chunk = chunk.strip()
            
            if clean_chunk:
                try:
                    data = json.loads(clean_chunk)
                    
                    if data.get("type") == "content" and is_first_chunk:
                        await async_redis.publish(
                            channel_name, 
                            json.dumps({'type': 'status', 'message': '✍️ 찾은 혜택들을 읽기 쉽게 정리하고 있어요!'}, ensure_ascii=False)
                        )
                        is_first_chunk = False
                        
                    if data.get("type") == "content":
                        full_content += data.get("delta", "")
                    elif data.get("type") == "done":
                        full_content = data.get("full_content", full_content)
                        
                except json.JSONDecodeError:
                    pass 
                
                await async_redis.publish(channel_name, clean_chunk)

        if full_content:
            logger.info(f"[{thread_id}] AI 답변 완료 (길이: {len(full_content)})")
            save_chat_message(user_id, thread_id, "assistant", full_content, message_type)
            
    except Exception as e:
        logger.error(f"[{thread_id}] ❌ AI 실행 에러: {str(e)}")
        traceback.print_exc()
        
        error_msg = str(e)[:100]
        await async_redis.publish(
            channel_name, 
            json.dumps({'type': 'error', 'message': f"AI 엔진 오류로 멈췄습니다. (상세: {error_msg}...)"}, ensure_ascii=False)
        )
    finally:
        await async_redis.close()

# ==============================================================================
# 🌟 [핵심 변경] 스마트 필터링 (True RAG)을 통한 맞춤형 DB 스캔 로직 추가
# ==============================================================================
@celery_app.task(name="worker.process_chat_task")
def process_chat_task(thread_id: str, user_id: str, agent_messages: list, message_type: str):
    logger.info(f"[{thread_id}] 컨텍스트 주입 및 스마트 필터링 시작...")
    
    # 1. 사용자 프로필 불러오기 및 기본값 세팅
    city, district, dong, birth_year, extra_info = "", "", "", "", ""
    try:
        inputs = load_thread_inputs(user_id, thread_id)
        city = inputs.get('selected_city', '')
        district = inputs.get('selected_district', '')
        dong = inputs.get('selected_dong', '')
        birth_year = inputs.get('birth_year', '')
        extra_info = inputs.get('extra_info', '')
        
        profile_text = f"- 거주지: {city} {district} {dong}\n- 출생연도: {birth_year}년생\n- 추가정보: {extra_info}"
    except Exception as e:
        logger.warning(f"사용자 프로필 로드 실패: {e}")
        profile_text = "프로필 정보 없음"

    # 2. Supabase DB에서 '나이'와 '키워드'에 맞는 데이터만 쏙 뽑아오기
    db_context = "현재 DB에서 데이터를 불러올 수 없습니다."
    if supabase:
        try:
            query = supabase.table("policies").select("title, agency, description")
            filters = []

            # (1) 나이 기반 '청년' 조건 자동 추가
            if birth_year and birth_year.isdigit():
                age = datetime.now().year - int(birth_year)
                if 19 <= age <= 34:
                    filters.append("title.ilike.%청년%")
                    filters.append("description.ilike.%청년%")

            # (2) 추가정보 기반 핵심 키워드 자동 추출
            if extra_info:
                # 사용자가 입력할 법한 대표 키워드 리스트
                target_keywords = ["취업", "창업", "주거", "월세", "전세", "IT", "소프트웨어", "개발", "금융", "의료", "건강"]
                for kw in target_keywords:
                    if kw in extra_info:
                        filters.append(f"title.ilike.%{kw}%")
                        filters.append(f"description.ilike.%{kw}%")

            # (3) 필터 조건이 모였다면 DB에 OR 조건으로 검색 명령 내리기
            if filters:
                or_condition = ",".join(filters)
                query = query.or_(or_condition)
                
            # 조건에 맞는 것만 최대 15~20개 추출
            response = query.limit(20).execute()

            if response.data:
                db_context = "\n".join([f"[{p.get('agency', '기관')}] {p.get('title', '제목')}: {p.get('description', '')[:100]}..." for p in response.data])
            else:
                db_context = "입력하신 조건과 직접적으로 일치하는 정부 공식 데이터가 부족합니다. AI가 가진 지자체 및 민간 지식을 활용해 대체 정책을 강력하게 추천해주세요."

        except Exception as e:
            logger.error(f"Supabase DB 스마트 검색 에러: {e}")

    # 3. 🧠 강력한 시스템 프롬프트(가스라이팅) 작성
    system_prompt_content = (
        "당신은 대한민국 최고의 '맞춤형 정책/지원금 내비게이터'입니다. "
        "사용자의 상황을 분석하여 받을 수 있는 **모든 혜택**을 총망라해서 친절하게 알려주어야 합니다.\n\n"
        
        f"### 👤 사용자 프로필 ###\n{profile_text}\n\n"
        
        f"### 🏛️ 스마트 필터링된 정부 공식 DB 리스트 (우선 참고) ###\n{db_context}\n\n"
        
        "### 🎯 답변 작성 지시사항 ###\n"
        "1. [국가 혜택]: 위 '스마트 필터링된 DB 리스트' 중에서 사용자에게 가장 적합한 혜택을 찾아 우선 추천하세요.\n"
        "2. [지자체 혜택]: (매우 중요) 사용자의 거주지(시/군/구)를 파악하고, 당신이 알고 있는 해당 지역의 특화 혜택(청년수당, 월세 지원, 취업 장려금 등)을 발굴해서 알려주세요.\n"
        "3. [민간/재단 혜택]: 정부 혜택 외에도 사용자의 '추가정보(관심사/상황)'와 관련된 공공기관이나 민간 재단의 지원금, 교육 프로그램 등을 꼭 추가하세요.\n"
        "4. 마크다운(글머리 기호, 굵은 글씨 등)을 활용하여 가독성 좋고 친절한 컨설턴트 말투로 답변하세요. "
        "존재하지 않는 혜택을 지어내지 말고(No Hallucination), 실제 존재하는 혜택 위주로 안내하세요."
    )

    enhanced_messages = [{"role": "system", "content": system_prompt_content}] + agent_messages
    asyncio.run(run_agent_and_publish(thread_id, user_id, enhanced_messages, message_type))

# ==============================================================================
# 🚀 [Phase 2 & 3] ETL Pipeline
# ==============================================================================
@celery_app.task(name="worker.collect_policies_task")
def collect_policies_task():
    logger.info("🚀 [ETL Pipeline] 정책 데이터 수집 봇 스웜 가동 시작...")
    try:
        sample_policy = {
            "policy_id": "GOV_YOUTH_RENT_001",
            "title": "청년 월세 특별지원 (2차)",
            "provider": "국토교통부",
            "category": "주거/금융",
            "target_audience": "만 19~34세 독립 거주 무주택 청년",
            "age_req": "만 19세 ~ 34세",
            "income_req": "기준 중위소득 60% 이하",
            "region_req": "전국",
            "summary": "월 최대 20만원씩 12개월간 월세를 지원하는 정책입니다.",
            "url": "https://www.bokjiro.go.kr",
            "deadline": "2025-02-24"
        }
        text_to_embed = f"{sample_policy['title']} {sample_policy['summary']} {sample_policy['target_audience']}"
        response = client.embeddings.create(input=text_to_embed, model="text-embedding-3-small")
        sample_policy['embedding'] = response.data[0].embedding
        upsert_policy(sample_policy)
        logger.info(f"✅ [ETL Pipeline] '{sample_policy['title']}' 수집 및 벡터화 완료!")
    except Exception as e:
        logger.error(f"❌ [ETL Pipeline] 오류: {str(e)}")
        traceback.print_exc()
