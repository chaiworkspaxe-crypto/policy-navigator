import os
import json
import asyncio
import traceback
import redis
import logging # 🌟 워커 상태 모니터링 로깅
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

# Celery 앱 설정
celery_app = Celery("policy_worker", broker=CELERY_BROKER_URL, backend=CELERY_BROKER_URL)
redis_client = redis.from_url(REDIS_URL)

async def run_agent_and_publish(thread_id: str, user_id: str, agent_messages: list, message_type: str):
    """AI 실행 및 Redis 채널로 실시간 송출"""
    agent_executor = create_agent_executor()
    full_content = ""
    channel_name = f"chat_{thread_id}"
    
    try:
        logger.info(f"[{thread_id}] AI 정책 검색 시작")
        
        # 🌟 사용자가 검색 중임을 인지하도록 디테일한 첫 메시지 송출 (ensure_ascii=False 추가)
        redis_client.publish(
            channel_name, 
            json.dumps({'type': 'status', 'message': '🔍 전국 정책 데이터를 샅샅이 뒤지는 중입니다...'}, ensure_ascii=False)
        )
        
        gen = get_ai_response_stream(agent_executor, agent_messages)
        is_first_chunk = True
        
        async for chunk in gen:
            # 🌟 [수정 핵심] openai_service.py가 이제 순수 JSON을 주므로 replace("data: ", "") 삭제!
            clean_chunk = chunk.strip()
            
            if clean_chunk:
                try:
                    data = json.loads(clean_chunk)
                    
                    # 🌟 [개선] Tool Calling이 끝나고 텍스트 생성을 시작할 때 상태 한 번 더 업데이트
                    if data.get("type") == "content" and is_first_chunk:
                        redis_client.publish(
                            channel_name, 
                            json.dumps({'type': 'status', 'message': '✍️ 누락된 정보가 없도록 꼼꼼하게 정리하고 있어요...'}, ensure_ascii=False)
                        )
                        is_first_chunk = False
                        
                    # 답변 조각 모으기
                    if data.get("type") == "content":
                        full_content += data.get("delta", "")
                    elif data.get("type") == "done":
                        # 스트림 완료 시 전체 답변 가져오기
                        full_content = data.get("full_content", full_content)
                        
                except json.JSONDecodeError:
                    pass # JSON 파싱 에러 시 무시하고 진행
                
                # 프론트엔드로 웹소켓용 JSON 데이터 바로 송출
                redis_client.publish(channel_name, clean_chunk)

        if full_content:
            logger.info(f"[{thread_id}] AI 답변 완료 (길이: {len(full_content)})")
            # DB 저장 (message_type을 파라미터로 받은 그대로 넘김)
            save_chat_message(user_id, thread_id, "assistant", full_content, message_type)
            
    except Exception as e:
        logger.error(f"[{thread_id}] ❌ AI 실행 에러: {str(e)}")
        traceback.print_exc()
        redis_client.publish(
            channel_name, 
            json.dumps({'type': 'error', 'message': "AI 분석 중 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."}, ensure_ascii=False)
        )

# 🌟 [중요] main.py에서 .delay()로 호출하는 task 이름("worker.process_chat_task")과 완벽히 일치하도록 네이밍
@celery_app.task(name="worker.process_chat_task")
def process_chat_task(thread_id: str, user_id: str, agent_messages: list, message_type: str):
    asyncio.run(run_agent_and_publish(thread_id, user_id, agent_messages, message_type))
