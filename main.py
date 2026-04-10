import os
import re
from datetime import datetime
from contextlib import asynccontextmanager
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# 👉 새로 추가된 DB 기능들 (rename_thread, delete_thread 등)을 임포트합니다.
from chat_db import (
    init_db,
    db_session,
    create_thread,
    rename_thread,
    delete_thread,
    list_user_threads,
    load_chat_messages,
    save_chat_message,
    save_thread_inputs,
    load_thread_inputs,
)
from openai_service import create_agent_executor, get_ai_response

load_dotenv()

CURRENT_YEAR = datetime.now().year
MAX_CONTEXT_MESSAGES = 6

# ==========================================
# 📦 Pydantic 모델 정의 (데이터 검증)
# ==========================================
class PolicySearchRequest(BaseModel):
    city: Optional[str] = Field(default=None, description="시/도")
    district: Optional[str] = Field(default=None, description="시/군/구")
    dong: Optional[str] = Field(default=None, description="읍/면/동")
    birth_year: Optional[str] = Field(default=None, description="4자리 출생연도")
    extra_info: Optional[str] = Field(default=None, description="직업, 가구, 주거 상태 등 추가 정보")
    query: Optional[str] = Field(default=None, description="자유 질문. 구조화 검색 없이 단일 질문만 보낼 때 사용")

class PolicySearchResponse(BaseModel):
    ok: bool
    message_type: str
    user_message: str
    answer: str

class ChatRequest(BaseModel):
    user_id: str = Field(description="사용자 구분용 ID")
    thread_id: Optional[str] = Field(default=None, description="기존 thread_id. 없으면 새 대화 생성")
    city: Optional[str] = Field(default=None, description="시/도")
    district: Optional[str] = Field(default=None, description="시/군/구")
    dong: Optional[str] = Field(default=None, description="읍/면/동")
    birth_year: Optional[str] = Field(default=None, description="4자리 출생연도")
    extra_info: Optional[str] = Field(default=None, description="직업, 가구, 주거 상태 등 추가 정보")
    query: Optional[str] = Field(default=None, description="추가 질문 또는 자유 질문")

class ChatResponse(BaseModel):
    ok: bool
    thread_id: str
    message_type: str
    user_message: str
    answer: str

# 👇 프론트엔드 연동을 위해 새롭게 추가된 데이터 규격들
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


# ==========================================
# 🛠️ 헬퍼 함수
# ==========================================
def is_valid_birth_year(text: str) -> bool:
    text = (text or "").strip()
    if not re.fullmatch(r"\d{4}", text):
        return False
    year = int(text)
    return 1900 <= year <= CURRENT_YEAR

def build_region_text(city: str, district: str, dong: str) -> str:
    region_text = f"{city} {district}"
    if dong and dong != "선택 안 함":
        region_text += f" {dong}"
    return region_text

def build_structured_user_message(region_text: str, birth_year: str, extra_info: str) -> str:
    return (
        "📌 입력 정보\n"
        f"- 거주지: {region_text}\n"
        f"- 출생연도: {birth_year}\n"
        f"- 추가 정보: {extra_info.strip()}"
    )

def normalize_request(city, district, dong, birth_year, extra_info, query) -> tuple[str, str]:
    city = (city or "").strip()
    district = (district or "").strip()
    dong = (dong or "").strip() or "선택 안 함"
    birth_year = (birth_year or "").strip()
    extra_info = (extra_info or "").strip()
    query = (query or "").strip()

    if query:
        return query, "followup_question"

    missing = []
    if not city or city == "선택하세요":
        missing.append("city")
    if not district or district == "선택하세요":
        missing.append("district")
    if not birth_year:
        missing.append("birth_year")
    if not extra_info:
        missing.append("extra_info")

    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"구조화 검색에는 다음 필드가 필요합니다: {', '.join(missing)}"
        )

    if not is_valid_birth_year(birth_year):
        raise HTTPException(
            status_code=400,
            detail="birth_year는 1900~현재 연도 사이의 4자리 숫자여야 합니다."
        )

    region_text = build_region_text(city, district, dong)
    user_message = build_structured_user_message(region_text, birth_year, extra_info)
    return user_message, "structured_search"

def build_agent_messages(previous_messages: list, current_user_message: str) -> list:
    agent_messages = []
    recent_messages = previous_messages[-MAX_CONTEXT_MESSAGES:]

    for message in recent_messages:
        role = message.get("role", "")
        content = message.get("content", "")
        if role in ["user", "assistant"] and content:
            agent_messages.append({
                "role": role,
                "content": content
            })

    agent_messages.append({
        "role": "user",
        "content": current_user_message
    })

    return agent_messages

def persist_thread_inputs_if_present(
    user_id: str,
    thread_id: str,
    city: Optional[str],
    district: Optional[str],
    dong: Optional[str],
    birth_year: Optional[str],
    extra_info: Optional[str],
):
    city = (city or "").strip()
    district = (district or "").strip()
    dong = (dong or "").strip() or "선택 안 함"
    birth_year = (birth_year or "").strip()
    extra_info = (extra_info or "").strip()

    if not any([city, district, dong, birth_year, extra_info]):
        return

    save_thread_inputs(
        user_id=user_id,
        thread_id=thread_id,
        selected_city=city or "선택하세요",
        selected_district=district or "선택하세요",
        selected_dong=dong or "선택 안 함",
        birth_year=birth_year,
        extra_info=extra_info
    )

# ==========================================
# 🚦 FastAPI 앱 초기화 및 미들웨어
# ==========================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

# 💡 [핵심] 여기서 딱 한 번만 앱을 만들고 설정을 몰아넣습니다.
app = FastAPI(
    title="Policy Navigator API",
    description="전국민 맞춤형 정책 내비게이터 FastAPI 백엔드",
    version="0.2.0",
    lifespan=lifespan,
)

# 💡 [CORS 설정] React 주소(로컬, IP)를 모두 수동으로 허용
allowed_origins = [
    "http://localhost:3000", 
    "http://127.0.0.1:3000",
    "http://192.168.100.185:3000",  # 터미널에 떴던 IP도 추가!
]

# (선택사항) 환경변수에 설정된 도메인도 있으면 같이 추가
allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "").strip()
if allowed_origins_env:
    allowed_origins.extend([origin.strip() for origin in allowed_origins_env.split(",") if origin.strip()])

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==========================================
# 🌐 시스템 및 헬스 체크 API
# ==========================================
@app.get("/")
def read_root():
    return {
        "ok": True,
        "service": "policy-navigator-api",
        "message": "FastAPI 백엔드가 정상 실행 중입니다."
    }

@app.get("/health")
def health_check():
    return {"ok": True, "status": "healthy"}

@app.get("/health/db")
def database_health_check():
    try:
        with db_session() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                row = cur.fetchone()
        return {
            "ok": True,
            "status": "healthy",
            "database": "connected",
            "result": row[0] if row else None
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"DB 연결 확인 실패: {type(e).__name__}: {e}"
        ) from e


# ==========================================
# 💬 채팅 및 AI 코어 API
# ==========================================
@app.post("/ask", response_model=PolicySearchResponse)
def ask_policy(request: PolicySearchRequest):
    try:
        user_message, message_type = normalize_request(
            request.city, request.district, request.dong,
            request.birth_year, request.extra_info, request.query
        )

        agent = create_agent_executor()
        answer = get_ai_response(
            agent=agent,
            messages=[{"role": "user", "content": user_message}]
        )

        return PolicySearchResponse(
            ok=True, message_type=message_type, user_message=user_message, answer=answer
        )
    except HTTPException: raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"정책 검색 실패: {e}") from e


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    try:
        user_id = (request.user_id or "").strip()
        thread_id = (request.thread_id or "").strip()

        if not user_id:
            raise HTTPException(status_code=400, detail="user_id는 필수입니다.")

        user_message, message_type = normalize_request(
            request.city, request.district, request.dong,
            request.birth_year, request.extra_info, request.query
        )

        if not thread_id:
            thread_id = create_thread(user_id=user_id, set_active=False)

        persist_thread_inputs_if_present(
            user_id=user_id, thread_id=thread_id,
            city=request.city, district=request.district, dong=request.dong,
            birth_year=request.birth_year, extra_info=request.extra_info,
        )

        previous_messages = load_chat_messages(user_id, thread_id)

        saved_user = save_chat_message(
            user_id=user_id, thread_id=thread_id, role="user",
            content=user_message, message_type=message_type
        )
        if not saved_user:
            raise HTTPException(status_code=500, detail="사용자 메시 저장 실패")

        agent_messages = build_agent_messages(previous_messages, user_message)
        agent = create_agent_executor()
        answer = get_ai_response(agent=agent, messages=agent_messages)

        saved_assistant = save_chat_message(
            user_id=user_id, thread_id=thread_id, role="assistant",
            content=answer, message_type="search_result" if message_type == "structured_search" else "followup_answer"
        )
        if not saved_assistant:
            raise HTTPException(status_code=500, detail="AI 응답 저장 실패")

        return ChatResponse(
            ok=True, thread_id=thread_id, message_type=message_type,
            user_message=user_message, answer=answer
        )

    except HTTPException: raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"채팅 처리 실패: {e}") from e


# ==========================================
# 🗂️ 대화 관리(스레드) API
# ==========================================
@app.get("/threads")
def get_threads(user_id: str = Query(..., description="조회할 사용자 ID")):
    try:
        user_id = user_id.strip()
        if not user_id:
            raise HTTPException(status_code=400, detail="user_id 누락")
        threads = list_user_threads(user_id)
        return {"ok": True, "threads": threads}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"목록 조회 실패: {e}")

@app.post("/threads")
def create_thread_api(req: CreateThreadRequest):
    try:
        thread_id = create_thread(user_id=req.user_id.strip(), set_active=True)
        return {"ok": True, "thread_id": thread_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"대화 생성 실패: {e}")

@app.get("/threads/{thread_id}/messages")
def get_thread_messages(thread_id: str, user_id: str = Query(...)):
    try:
        messages = load_chat_messages(user_id.strip(), thread_id.strip())
        return {"ok": True, "thread_id": thread_id, "messages": messages}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"메시지 조회 실패: {e}")

@app.get("/threads/{thread_id}/inputs")
def get_thread_inputs_api(thread_id: str, user_id: str = Query(...)):
    try:
        inputs = load_thread_inputs(user_id.strip(), thread_id.strip())
        return {"ok": True, "thread_id": thread_id, "inputs": inputs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"입력값 조회 실패: {e}")

@app.patch("/threads/{thread_id}")
def rename_thread_api(thread_id: str, req: RenameRequest):
    try:
        rename_thread(req.user_id.strip(), thread_id, req.title.strip())
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"대화 제목 변경 실패: {e}")

@app.delete("/threads/{thread_id}")
def delete_thread_api(thread_id: str, user_id: str = Query(...)):
    try:
        delete_thread(user_id.strip(), thread_id)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"대화 삭제 실패: {e}")

@app.post("/threads/{thread_id}/inputs")
def save_inputs_api(thread_id: str, req: SaveInputsRequest):
    try:
        save_thread_inputs(
            user_id=req.user_id.strip(),
            thread_id=thread_id,
            selected_city=req.selected_city or "선택하세요",
            selected_district=req.selected_district or "선택하세요",
            selected_dong=req.selected_dong or "선택 안 함",
            birth_year=req.birth_year or "",
            extra_info=req.extra_info or ""
        )
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"입력 상태 저장 실패: {e}")