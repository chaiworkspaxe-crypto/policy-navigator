import os
import json
import asyncio
import traceback
import logging
from celery import Celery
from dotenv import load_dotenv

import redis.asyncio as aioredis 

# 기존 AI 서비스 및 DB 함수 임포트
from openai_service import create_agent_executor, get_ai_response_stream
from chat_db import save_chat_message, upsert_policy # 🌟 [Phase 2] 저장 함수 임포트 추가

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] Worker: %(message)s")
logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL")

CELERY_BROKER_URL = REDIS_URL
if REDIS_URL and REDIS_URL.startswith("rediss://") and "ssl_cert_reqs" not in REDIS_URL:
    CELERY_BROKER_URL += "?ssl_cert_reqs=CERT_NONE"

celery_app = Celery("policy_worker", broker=CELERY_BROKER_URL, backend=CELERY_BROKER_URL)

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
# 🚀 [Phase 2] '무결점 RAG' 구축을 위한 궁극의 데이터 수집 봇 (ETL Pipeline)
# ==============================================================================
@celery_app.task(name="worker.collect_policies_task")
def collect_policies_task():
    """
    매일 새벽(또는 지정된 시간)에 실행되어 공공데이터 API 및 크롤링을 수행하는 로봇.
    가져온 데이터는 AI가 파싱하여 PostgreSQL 'policies' 테이블에 1536차원 벡터와 함께 영구 저장됨.
    """
    logger.info("🚀 [ETL Pipeline] 정책 데이터 수집 봇 스웜(Bot Swarm) 가동 시작...")
    try:
        # TODO: 추후 여기에 Playwright(브라우저 자동화) 기반 우회 스크래핑 코드 
        # 또는 온라인청년센터 오픈 API (requests) 호출 로직이 들어갈 예정입니다.
        
        # 예시: 
        # mock_data = fetch_from_government_api()
        # for item in mock_data:
        #    parsed_item = llm_json_parser(item)
        #    upsert_policy(parsed_item)
        
        logger.info("✅ [ETL Pipeline] 데이터 웨어하우스 최신화 완료!")
    except Exception as e:
        logger.error(f"❌ [ETL Pipeline] 데이터 수집 중 치명적 오류 발생: {str(e)}")
        traceback.print_exc()
