import os
import json
import asyncio
import traceback
import redis
from celery import Celery
from dotenv import load_dotenv

# 기존 AI 서비스 및 DB 함수 임포트
from openai_service import create_agent_executor, get_ai_response_stream
from chat_db import save_chat_message

load_dotenv()

# Upstash Redis 주소
REDIS_URL = os.getenv("REDIS_URL")

# Celery 앱 설정
celery_app = Celery("policy_worker", broker=REDIS_URL, backend=REDIS_URL)
redis_client = redis.from_url(REDIS_URL)

async def run_agent_and_publish(thread_id: str, user_id: str, agent_messages: list, message_type: str):
    """AI 실행 및 Redis 채널로 실시간 송출"""
    agent_executor = create_agent_executor()
    full_content = ""
    channel_name = f"chat_{thread_id}"
    
    try:
        redis_client.publish(channel_name, json.dumps({'type': 'status', 'message': '🔍 AI가 분석을 시작합니다...'}))
        
        gen = get_ai_response_stream(agent_executor, agent_messages)
        async for chunk in gen:
            clean_chunk = chunk.replace("data: ", "").strip()
            if clean_chunk:
                redis_client.publish(channel_name, clean_chunk)
                try:
                    data = json.loads(clean_chunk)
                    if data.get("type") == "content":
                        full_content += data.get("delta", "")
                except: pass

        if full_content:
            save_chat_message(user_id, thread_id, "assistant", full_content, "search_result")
            
    except Exception as e:
        redis_client.publish(channel_name, json.dumps({'type': 'error', 'message': str(e)}))

@celery_app.task(name="process_chat_task")
def process_chat_task(thread_id: str, user_id: str, agent_messages: list, message_type: str):
    asyncio.run(run_agent_and_publish(thread_id, user_id, agent_messages, message_type))
