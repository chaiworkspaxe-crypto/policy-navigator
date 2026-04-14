import os
import json
import asyncio
import traceback
import logging
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

# Celery 전용 브로커 URL (Celery는 CERT_NONE 대문자를 좋아함)
CELERY_BROKER_URL = REDIS_URL
clean_base_url = REDIS_URL.split("?")[0] if REDIS_URL else ""
if clean_base_url.startswith("rediss://") and "ssl_cert_reqs" not in (REDIS_URL or ""):
    CELERY_BROKER_URL = clean_base_url + "?ssl_cert_reqs=CERT_NONE"

celery_app = Celery("policy_worker", broker=CELERY_BROKER_URL, backend=CELERY_BROKER_URL)
client = OpenAI()

# 🌟 [추가] Supabase DB 연결 초기화
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# 🌟 [완벽 해결] aioredis는 꼬리표 다 떼고 "none" 소문자만 전달!
def get_async_redis_client():
    clean_url = REDIS_URL.split("?")[0] if REDIS_URL else ""
    if clean_url.startswith("rediss://"):
        return aioredis.from_url(clean_url, ssl_cert_reqs="none")
    return aioredis.from_url(clean_url)

# ==============================================================================
# [라이브 서비스] 유저가 검색을 누르면 실시간으로 돌아가는 기존 AI 에이전트
# ==============================================================================
async def run_agent_and_publish(thread_id: str, user_id: str, agent_messages: list, message_type: str):
    """AI 실행 및 Redis 채널로 실시간 송출"""
    
    # 🌟 [해결 1] 프론트엔드가 웹소켓 문을 열 수 있도록 1.5초 기다려주는 매너 타임
    await asyncio.sleep(1.5)
    
    full_content = ""
    channel_name = f"chat_{thread_id}"
    
    # 🌟 [수정] 꼬리표 없는 안전한 Redis 클라이언트로 연결
    async_redis = get_async_redis_client()
    
    try:
        logger.info(f"[{thread_id}] AI 정책 검색 시작")
        
        await async_redis.publish(
            channel_name, 
            json.dumps({'type': 'status', 'message': '🔍 전국 정책 DB와 지자체 혜택을 매칭 중입니다...'}, ensure_ascii=False)
        )
        
        # 🌟 [해결 2] AI 엔진 생성 코드를 try 블록 안으로 이동!
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
                            json.dumps({'type': 'status', 'message': '✍️ 창현 님에게 딱 맞는 혜택을 정리하고 있어요!'}, ensure_ascii=False)
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
        
        # 🌟 이제 에러가 나면 무한 로딩 대신, 정확한 에러 원인을 유저 화면에 띄워줌!
        error_msg = str(e)[:100]
        await async_redis.publish(
            channel_name, 
            json.dumps({'type': 'error', 'message': f"AI 엔진 오류로 멈췄습니다. (상세: {error_msg}...)"}, ensure_ascii=False)
        )
    finally:
        await async_redis.close()

# ==============================================================================
# 🌟 [핵심 변경] AI에게 넘기기 전에 Supabase 데이터와 사용자 프로필을 주입하는 작업
# ==============================================================================
@celery_app.task(name="worker.process_chat_task")
def process_chat_task(thread_id: str, user_id: str, agent_messages: list, message_type: str):
    logger.info(f"[{thread_id}] 컨텍스트 주입 시작...")
    
    # 1. 사용자 프로필(지역, 나이, 관심사) 불러오기
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

    # 2. Supabase DB에서 최신 정부 정책 데이터 긁어오기 (가스라이팅용)
    db_context = "현재 DB에서 데이터를 불러올 수 없습니다."
    if supabase:
        try:
            # 너무 많으면 토큰 낭비니까 15개 정도만 참고용으로 가져옴
            response = supabase.table("policies").select("title, agency, description").limit(15).execute()
            if response.data:
                db_context = "\n".join([f"[{p.get('agency', '기관')}] {p.get('title', '제목')}: {p.get('description', '')[:100]}..." for p in response.data])
        except Exception as e:
            logger.error(f"Supabase DB 읽기 에러: {e}")

    # 3. 🧠 강력한 시스템 프롬프트(가스라이팅) 작성
    system_prompt_content = (
        "당신은 대한민국 최고의 '맞춤형 정책/지원금 내비게이터'입니다. "
        "사용자의 상황을 분석하여 받을 수 있는 **모든 혜택**을 총망라해서 친절하게 알려주어야 합니다.\n\n"
        
        f"### 👤 사용자 프로필 ###\n{profile_text}\n\n"
        
        f"### 🏛️ 공식 정부 DB 정책 리스트 (참고용) ###\n{db_context}\n\n"
        
        "### 🎯 답변 작성 지시사항 ###\n"
        "1. [국가 혜택]: 위 '공식 정부 DB 정책 리스트' 중에서 사용자에게 적합한 혜택을 찾아 우선 추천하세요.\n"
        "2. [지자체 혜택]: (매우 중요) 사용자의 거주지(시/군/구)를 파악하고, 당신이 알고 있는 해당 지역의 특화 혜택(청년수당, 월세 지원 등)을 발굴해서 알려주세요.\n"
        "3. [민간/재단 혜택]: 정부 혜택 외에도 사용자의 '추가정보(관심사/상황)'와 관련된 공공기관이나 민간 재단의 지원금, 교육 프로그램 등을 꼭 추가하세요.\n"
        "4. 마크다운(글머리 기호, 굵은 글씨 등)을 활용하여 가독성 좋고 친절한 컨설턴트 말투로 답변하세요. "
        "존재하지 않는 혜택을 지어내지 말고(No Hallucination), 실제 존재하는 혜택 위주로 안내하세요."
    )

    # 기존 메시지 리스트의 맨 앞에 시스템 프롬프트(지시사항)를 끼워 넣음!
    enhanced_messages = [{"role": "system", "content": system_prompt_content}] + agent_messages

    # 완성된 메시지를 들고 기존 AI 스트리밍 함수로 이동
    asyncio.run(run_agent_and_publish(thread_id, user_id, enhanced_messages, message_type))


# ==============================================================================
# 🚀 [Phase 2 & 3] '무결점 RAG' 구축을 위한 궁극의 데이터 수집 봇 (ETL Pipeline)
# ==============================================================================
@celery_app.task(name="worker.collect_policies_task")
def collect_policies_task():
    """
    매일 새벽(또는 지정된 시간)에 실행되어 공공데이터 API 및 크롤링을 수행하는 로봇.
    """
    logger.info("🚀 [ETL Pipeline] 정책 데이터 수집 봇 스웜(Bot Swarm) 가동 시작...")
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
        
        response = client.embeddings.create(
            input=text_to_embed, 
            model="text-embedding-3-small"
        )
        sample_policy['embedding'] = response.data[0].embedding

        upsert_policy(sample_policy)
        
        logger.info(f"✅ [ETL Pipeline] '{sample_policy['title']}' 수집 및 벡터화 완료!")
    except Exception as e:
        logger.error(f"❌ [ETL Pipeline] 데이터 수집 중 치명적 오류 발생: {str(e)}")
        traceback.print_exc()
