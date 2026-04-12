import os
import json
import asyncio
import traceback
import logging
from celery import Celery
from dotenv import load_dotenv
from openai import OpenAI # 🌟 [Phase 3] 텍스트 벡터 변환을 위해 추가

import redis.asyncio as aioredis 

# 기존 AI 서비스 및 DB 함수 임포트
from openai_service import create_agent_executor, get_ai_response_stream
from chat_db import save_chat_message, upsert_policy # 🌟 [Phase 2] 저장 함수 임포트

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] Worker: %(message)s")
logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL")

CELERY_BROKER_URL = REDIS_URL
if REDIS_URL and REDIS_URL.startswith("rediss://") and "ssl_cert_reqs" not in REDIS_URL:
    CELERY_BROKER_URL += "?ssl_cert_reqs=CERT_NONE"

celery_app = Celery("policy_worker", broker=CELERY_BROKER_URL, backend=CELERY_BROKER_URL)
client = OpenAI() # 🌟 OpenAI API 클라이언트 초기화

# ==============================================================================
# [라이브 서비스] 유저가 검색을 누르면 실시간으로 돌아가는 기존 AI 에이전트
# ==============================================================================
async def run_agent_and_publish(thread_id: str, user_id: str, agent_messages: list, message_type: str):
    """AI 실행 및 Redis 채널로 실시간 송출"""
    agent_executor = create_agent_executor()
    full_content = ""
    channel_name = f"chat_{thread_id}"
    
    async_redis = aioredis.from_url(REDIS_URL)
    
    try:
        logger.info(f"[{thread_id}] AI 정책 검색 시작")
        
        await async_redis.publish(
            channel_name, 
            json.dumps({'type': 'status', 'message': '🔍 전국 정책 데이터를 샅샅이 뒤지는 중입니다...'}, ensure_ascii=False)
        )
        
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
                            json.dumps({'type': 'status', 'message': '✍️ 누락된 정보가 없도록 꼼꼼하게 정리하고 있어요...'}, ensure_ascii=False)
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
        await async_redis.publish(
            channel_name, 
            json.dumps({'type': 'error', 'message': "AI 분석 중 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."}, ensure_ascii=False)
        )
    finally:
        await async_redis.close()

@celery_app.task(name="worker.process_chat_task")
def process_chat_task(thread_id: str, user_id: str, agent_messages: list, message_type: str):
    asyncio.run(run_agent_and_publish(thread_id, user_id, agent_messages, message_type))


# ==============================================================================
# 🚀 [Phase 2 & 3] '무결점 RAG' 구축을 위한 궁극의 데이터 수집 봇 (ETL Pipeline)
# ==============================================================================
@celery_app.task(name="worker.collect_policies_task")
def collect_policies_task():
    """
    매일 새벽(또는 지정된 시간)에 실행되어 공공데이터 API 및 크롤링을 수행하는 로봇.
    가져온 데이터는 AI가 파싱하여 PostgreSQL 'policies' 테이블에 1536차원 벡터와 함께 영구 저장됨.
    """
    logger.info("🚀 [ETL Pipeline] 정책 데이터 수집 봇 스웜(Bot Swarm) 가동 시작...")
    try:
        # 💡 실전 테스트용 샘플 데이터 1건 생성 (추후 진짜 API 연동 로직으로 확장될 부분입니다)
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

        # 🧠 [Phase 3] 데이터를 AI 검색이 가능하도록 벡터화(Embedding)
        # 정책의 제목, 요약, 대상자를 하나로 합쳐서 AI가 의미를 파악하기 좋은 문장으로 만듭니다.
        text_to_embed = f"{sample_policy['title']} {sample_policy['summary']} {sample_policy['target_audience']}"
        
        # OpenAI 임베딩 모델(text-embedding-3-small)을 사용해 텍스트를 숫자로 변환
        response = client.embeddings.create(
            input=text_to_embed, 
            model="text-embedding-3-small"
        )
        sample_policy['embedding'] = response.data[0].embedding

        # 변환된 벡터 데이터를 포함하여 DB에 꽂아넣기
        upsert_policy(sample_policy)
        
        logger.info(f"✅ [ETL Pipeline] '{sample_policy['title']}' 수집 및 벡터화 완료!")
    except Exception as e:
        logger.error(f"❌ [ETL Pipeline] 데이터 수집 중 치명적 오류 발생: {str(e)}")
        traceback.print_exc()
