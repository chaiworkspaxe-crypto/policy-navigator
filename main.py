import os
import re
import json
import asyncio 
import traceback
import hashlib
from datetime import datetime
from contextlib import asynccontextmanager
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import redis.asyncio as aioredis # 🌟 [추가] 비동기 Redis 통신

from chat_db import (
    init_db, db_session, create_thread, rename_thread, delete_thread,
    list_user_threads, load_chat_messages, save_chat_message,
    save_thread_inputs, load_thread_inputs,
    consume_daily_request_quota,
    get_admin_dashboard_stats
)
from worker import process_chat_task

load_dotenv()

CURRENT_YEAR = datetime.now().year
MAX_CONTEXT_MESSAGES = 6

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# 🌟 [추가] 관리자 비밀 암호 (환경변수가 없으면 기본값 8011 사용)
ADMIN_PASS_KEY = os.getenv("ADMIN_PASS_KEY", "8011")

def get_client_fingerprint(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    ip = forwarded.split(",")[0] if forwarded else request.client.host
    user_agent = request.headers.get("User-Agent", "Unknown")
    
    raw_fingerprint = f"{ip}-{user_agent}"
    return hashlib.sha256(raw_fingerprint.encode('utf-8')).hexdigest()

class PolicySearchRequest(BaseModel):
    city: Optional[str] = Field(default=None, description="시/도")
    district: Optional[str] = Field(default=None, description="시/군/구")
    dong: Optional[str] = Field(default=None, description="읍/면/동")
    birth_year: Optional[str] = Field(default=None, description="4자리 출생연도")
    extra_info: Optional[str] = Field(default=None, description="추가 정보")
    query: Optional[str] = Field(default=None, description="자유 질문")

class PolicySearchResponse(BaseModel):
    ok: bool
    message_type: str
    user_message: str
    answer: str

class ChatRequest(BaseModel):
    user_id: str
    thread_id: Optional[str] = None
    city: Optional[str] = None
    district: Optional[str] = None
    dong: Optional[str] = None
    birth_year: Optional[str] = None
    extra_info: Optional[str] = None
    query: Optional[str] = None

class CreateThreadRequest(BaseModel):
    user_id: str

class RenameRequest(BaseModel):
    user_id: str
    title: str

class SaveInputsRequest(BaseModel):
    user_id: str
    selected_city: Optional[str] = None
    selected_district: Optional[str] = None
    selected_dong: Optional[str] = None
    birth_year: Optional[str] = None
    extra_info: Optional[str] = None

def is_valid_birth_year(text: str) -> bool:
    text = (text or "").strip()
    if not re.fullmatch(r"\d{4}", text): return False
    return 1900 <= int(text) <= CURRENT_YEAR

def build_region_text(city: str, district: str, dong: str) -> str:
    region_text = f"{city} {district}"
    if dong and dong != "선택 안 함": region_text += f" {dong}"
    return region_text

def build_structured_user_message(region_text: str, birth_year: str, extra_info: str) -> str:
    return (
        "📌 입력 정보\n"
        f"- 거주지: {region_text}\n"
        f"- 출생연도: {birth_year}\n"
        f"- 추가 정보: {extra_info.strip()}"
    )

def normalize_request(city, district, dong, birth_year, extra_info, query) -> tuple[str, str]:
    city, district, dong = (city or "").strip(), (district or "").strip(), (dong or "").strip() or "선택 안 함"
    birth_year, extra_info, query = (birth_year or "").strip(), (extra_info or "").strip(), (query or "").strip()

    if query: return query, "followup_question"

    missing = []
    if not city or city == "선택하세요": missing.append("city")
    if not district or district == "선택하세요": missing.append("district")
    if not birth_year: missing.append("birth_year")
    if not extra_info: missing.append("extra_info")

    if missing: raise HTTPException(status_code=400, detail=f"필수 필드 누락: {', '.join(missing)}")
    if not is_valid_birth_year(birth_year): raise HTTPException(status_code=400, detail="올바른 출생연도를 입력하세요.")

    return build_structured_user_message(build_region_text(city, district, dong), birth_year, extra_info), "structured_search"

def build_agent_messages(previous_messages: list, current_user_message: str) -> list:
    agent_messages = [{"role": m["role"], "content": m["content"]} for m in previous_messages[-MAX_CONTEXT_MESSAGES:] if m.get("content")]
    agent_messages.append({"role": "user", "content": current_user_message})
    return agent_messages

def persist_thread_inputs_if_present(user_id, thread_id, city, district, dong, birth_year, extra_info):
    if not any([city, district, dong, birth_year, extra_info]): return
    save_thread_inputs(
        user_id=user_id, thread_id=thread_id,
        selected_city=(city or "").strip() or "선택하세요",
        selected_district=(district or "").strip() or "선택하세요",
        selected_dong=(dong or "").strip() or "선택 안 함",
        birth_year=(birth_year or "").strip(),
        extra_info=(extra_info or "").strip()
    )

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

app = FastAPI(title="Policy Navigator API", lifespan=lifespan)

allowed_origins = [
    "http://localhost:3000", "http://127.0.0.1:3000",
    "http://localhost:3001", "http://127.0.0.1:3001",
    "https://policy-navigator-lac.vercel.app", 
]
if os.getenv("ALLOWED_ORIGINS"):
    allowed_origins.extend([o.strip() for o in os.getenv("ALLOWED_ORIGINS").split(",") if o.strip()])

app.add_middleware(
    CORSMiddleware, allow_origins=allowed_origins,
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

@app.get("/")
def read_root(): return {"ok": True, "message": "FastAPI 백엔드가 정상 실행 중입니다."}

@app.get("/health")
def health_check(): return {"ok": True, "status": "healthy"}

@app.get("/admin/stats")
def admin_stats():
    return {"ok": True, "data": get_admin_dashboard_stats()}

@app.post("/chat")
async def chat(request: ChatRequest, http_request: Request):
    try:
        user_id, thread_id = (request.user_id or "").strip(), (request.thread_id or "").strip()
        if not user_id: raise HTTPException(status_code=400, detail="user_id는 필수입니다.")

        # 🌟 [수정] 아이디가 비밀 암호(8011)와 일치하는지 확인!
        is_admin = (user_id == ADMIN_PASS_KEY)

        # 🌟 [수정] 관리자가 아닐 때(일반 유저일 때)만 횟수를 깎음
        if not is_admin:
            fingerprint = get_client_fingerprint(http_request)
            quota = consume_daily_request_quota(fingerprint, daily_limit=4)
            
            if not quota["allowed"]:
                raise HTTPException(
                    status_code=403, 
                    detail="오늘의 맞춤 혜택 검색 횟수(4회)를 모두 사용하셨습니다. 서버 유지를 위해 내일 다시 찾아와 주세요! 🙇‍♂️"
                )

        user_message, message_type = normalize_request(
            request.city, request.district, request.dong,
            request.birth_year, request.extra_info, request.query
        )

        if not thread_id: thread_id = create_thread(user_id=user_id, set_active=False)

        persist_thread_inputs_if_present(
            user_id, thread_id, request.city, request.district, request.dong,
            request.birth_year, request.extra_info
        )

        previous_messages = load_chat_messages(user_id, thread_id)
        save_chat_message(user_id, thread_id, "user", user_message, message_type)

        agent_messages = build_agent_messages(previous_messages, user_message)

        # 🚀 Celery Worker에게 작업 지시 (비동기 처리)
        process_chat_task.delay(thread_id, user_id, agent_messages, message_type)

        return {"ok": True, "thread_id": thread_id, "message": "Task queued successfully"}

    except HTTPException: raise
    except Exception as e: 
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.websocket("/ws/chat/{thread_id}")
async def websocket_endpoint(websocket: WebSocket, thread_id: str):
    await websocket.accept()
    
    redis_client = aioredis.from_url(REDIS_URL)
    pubsub = redis_client.pubsub()
    channel_name = f"chat_{thread_id}"
    await pubsub.subscribe(channel_name)

    try:
        async for message in pubsub.listen():
            if message['type'] == 'message':
                data = message['data'].decode('utf-8')
                await websocket.send_text(data)
                
                if '"type": "done"' in data or '"type": "error"' in data:
                    break
    except WebSocketDisconnect:
        pass 
    except Exception as e:
        print(f"웹소켓 에러: {e}")
    finally:
        await pubsub.unsubscribe(channel_name)
        await redis_client.close()
        try:
            await websocket.close()
        except: pass

@app.get("/threads")
def get_threads(user_id: str = Query(...)): return {"ok": True, "threads": list_user_threads(user_id.strip())}
@app.post("/threads")
def create_thread_api(req: CreateThreadRequest): return {"ok": True, "thread_id": create_thread(req.user_id.strip(), set_active=True)}
@app.get("/threads/{thread_id}/messages")
def get_thread_messages(thread_id: str, user_id: str = Query(...)): return {"ok": True, "thread_id": thread_id, "messages": load_chat_messages(user_id.strip(), thread_id.strip())}
@app.get("/threads/{thread_id}/inputs")
def get_thread_inputs_api(thread_id: str, user_id: str = Query(...)): return {"ok": True, "thread_id": thread_id, "inputs": load_thread_inputs(user_id.strip(), thread_id.strip())}
@app.patch("/threads/{thread_id}")
def rename_thread_api(thread_id: str, req: RenameRequest): rename_thread(req.user_id.strip(), thread_id, req.title.strip()); return {"ok": True}
@app.delete("/threads/{thread_id}")
def delete_thread_api(thread_id: str, user_id: str = Query(...)): delete_thread(user_id.strip(), thread_id); return {"ok": True}
@app.post("/threads/{thread_id}/inputs")
def save_inputs_api(thread_id: str, req: SaveInputsRequest): save_thread_inputs(req.user_id.strip(), thread_id, req.selected_city or "선택하세요", req.selected_district or "선택하세요", req.selected_dong or "선택 안 함", req.birth_year or "", req.extra_info or ""); return {"ok": True}
