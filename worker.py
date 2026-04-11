import os
import json
import asyncio
import traceback
import redis
import logging # 🌟 [추가] 워커 상태 모니터링 로깅
from celery import Celery
from dotenv import load_dotenv

# 기존 AI 서비스 및 DB 함수 임포트
from openai_service import create_agent_executor, get_ai_response_stream
from chat_db import save_chat_message

load_dotenv()

# 🌟 워커용 로깅 설정
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] Worker: %(message)s")
logger = logging.getLogger(__name__)

# Upstash Redis 주소
REDIS_URL = os.getenv("REDIS_URL")

# 🌟 [에러 해결] Celery가 rediss:// (보안 연결)을 사용할 때 SSL 인증서 에러가 나지 않도록 옵션 추가
CELERY_BROKER_URL = REDIS_URL
if REDIS_URL and REDIS_URL.startswith("rediss://") and "ssl_cert_reqs" not in REDIS_URL:
    CELERY_BROKER_URL += "?ssl_cert_reqs=CERT_NONE"

# Celery 앱 설정 (수정된 URL 사용)
celery_app = Celery("policy_worker", broker=CELERY_BROKER_URL, backend=CELERY_BROKER_URL)
redis_client = redis.from_url(REDIS_URL)

async def run_agent_and_publish(thread_id: str, user_id: str, agent_messages: list, message_type: str):
    """AI 실행 및 Redis 채널로 실시간 송출"""
    agent_executor = create_agent_executor()
    full_content = ""
    channel_name = f"chat_{thread_id}"
    
    try:
        logger.info(f"[{thread_id}] AI 정책 검색 시작")
        # 🌟 [개선] 사용자가 검색 중임을 인지하도록 디테일한 첫 메시지 송출
        redis_client.publish(channel_name, json.dumps({'type': 'status', 'message': '🔍 전국 정책 데이터를 샅샅이 뒤지는 중입니다...'}))
        
        gen = get_ai_response_stream(agent_executor, agent_messages)
        is_first_chunk = True
        
        async for chunk in gen:
            clean_chunk = chunk.replace("data: ", "").strip()
            if clean_chunk:
                # 🌟 [개선] 검색이 끝나고 첫 타자를 치기 직전에 상태 업데이트 (체감 대기시간 감소)
                if is_first_chunk:
                    redis_client.publish(channel_name, json.dumps({'type': 'status', 'message': '✍️ 누락된 정보가 없도록 꼼꼼하게 정리하고 있어요...'}))
                    is_first_chunk = False
                    
                redis_client.publish(channel_name, clean_chunk)
                try:
                    data = json.loads(clean_chunk)
                    if data.get("type") == "content":
                        full_content += data.get("delta", "")
                except: pass

        if full_content:
            logger.info(f"[{thread_id}] AI 답변 완료 (길이: {len(full_content)})")
            save_chat_message(user_id, thread_id, "assistant", full_content, "search_result")
            
    except Exception as e:
        logger.error(f"[{thread_id}] ❌ AI 실행 에러: {str(e)}")
        traceback.print_exc()
        redis_client.publish(channel_name, json.dumps({'type': 'error', 'message': "AI 분석 중 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."}))

@celery_app.task(name="process_chat_task")
def process_chat_task(thread_id: str, user_id: str, agent_messages: list, message_type: str):
    asyncio.run(run_agent_and_publish(thread_id, user_id, agent_messages, message_type))
