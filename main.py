import os
import re
import json
import asyncio 
import traceback
from datetime import datetime
from contextlib import asynccontextmanager
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from chat_db import (
    init_db, db_session, create_thread, rename_thread, delete_thread,
    list_user_threads, load_chat_messages, save_chat_message,
    save_thread_inputs, load_thread_inputs,
    consume_daily_request_quota,
    get_admin_dashboard_stats # 🌟 [추가] 관리자 통계 함수 임포트
)
from openai_service import create_agent_executor, get_ai_response, get_ai_response_stream

load_dotenv()

CURRENT_YEAR = datetime.now().year
MAX_CONTEXT_MESSAGES = 6

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

# 🌟 [추가] 관리자 대시보드 통계 API
@app.get("/admin/stats")
def admin_stats():
    return {"ok": True, "data": get_admin_dashboard_stats()}

@app.post("/ask", response_model=PolicySearchResponse)
def ask_policy(request: PolicySearchRequest):
    try:
        user_msg, msg_type = normalize_request(request.city, request.district, request.dong, request.birth_year, request.extra_info, request.query)
        agent = create_agent_executor()
        answer = get_ai_response(agent_executor=agent, messages=[{"role": "user", "content": user_msg}])
        return PolicySearchResponse(ok=True, message_type=msg_type, user_message=user_msg, answer=answer)
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat")
async def chat(request: ChatRequest):
    try:
        user_id, thread_id = (request.user_id or "").strip(), (request.thread_id or "").strip()
        if not user_id: raise HTTPException(status_code=400, detail="user_id는 필수입니다.")

        quota = consume_daily_request_quota(user_id, daily_limit=4)
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
        agent_executor = create_agent_executor()

        async def event_generator():
            full_content = ""
            deadline = asyncio.get_running_loop().time() + 180  

            try:
                yield f"data: {json.dumps({'type': 'thread_id', 'thread_id': thread_id}, ensure_ascii=False)}\n\n"
                gen = get_ai_response_stream(agent_executor, agent_messages)
                
                while True:
                    timeout_left = deadline - asyncio.get_running_loop().time()
                    if timeout_left <= 0:
                        raise asyncio.TimeoutError() 

                    try:
                        chunk = await asyncio.wait_for(anext(gen), timeout=timeout_left)
                        yield chunk
                        
                        if "full_content" in chunk:
                            try:
                                data = json.loads(chunk.replace("data: ", ""))
                                full_content = data.get("full_content", "")
                            except: pass
                    except StopAsyncIteration:
                        break 
                        
                if full_content:
                    save_chat_message(
                        user_id, thread_id, "assistant", full_content, 
                        "search_result" if message_type == "structured_search" else "followup_answer"
                    )

            except asyncio.TimeoutError:
                yield f"data: {json.dumps({'type': 'error', 'message': '정책 데이터 조회 시간이 초과되었습니다. 검색 조건을 좁혀서 다시 시도해 주세요.'}, ensure_ascii=False)}\n\n"
            except Exception as stream_err:
                traceback.print_exc()
                yield f"data: {json.dumps({'type': 'error', 'message': f'분석 중 오류 발생: {str(stream_err)}'}, ensure_ascii=False)}\n\n"

        return StreamingResponse(event_generator(), media_type="text/event-stream")

    except HTTPException: raise
    except Exception as e: 
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/threads")
def get_threads(user_id: str = Query(...)): return {"ok": True, "threads": list_user_threads(user_id.strip())}

@app.post("/threads")
def create_thread_api(req: CreateThreadRequest): return {"ok": True, "thread_id": create_thread(req.user_id.strip(), set_active=True)}

@app.get("/threads/{thread_id}/messages")
def get_thread_messages(thread_id: str, user_id: str = Query(...)): return {"ok": True, "thread_id": thread_id, "messages": load_chat_messages(user_id.strip(), thread_id.strip())}

@app.get("/threads/{thread_id}/inputs")
def get_thread_inputs_api(thread_id: str, user_id: str = Query(...)): return {"ok": True, "thread_id": thread_id, "inputs": load_thread_inputs(user_id.strip(), thread_id.strip())}

@app.patch("/threads/{thread_id}")
def rename_thread_api(thread_id: str, req: RenameRequest): 
    rename_thread(req.user_id.strip(), thread_id, req.title.strip())
    return {"ok": True}

@app.delete("/threads/{thread_id}")
def delete_thread_api(thread_id: str, user_id: str = Query(...)):
    delete_thread(user_id.strip(), thread_id)
    return {"ok": True}

@app.post("/threads/{thread_id}/inputs")
def save_inputs_api(thread_id: str, req: SaveInputsRequest):
    save_thread_inputs(
        req.user_id.strip(), thread_id, req.selected_city or "선택하세요", 
        req.selected_district or "선택하세요", req.selected_dong or "선택 안 함", 
        req.birth_year or "", req.extra_info or ""
    )
    return {"ok": True}