import os
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo
from contextlib import contextmanager

import psycopg2
from psycopg2.pool import ThreadedConnectionPool
from psycopg2.extras import DictCursor
from pgvector.psycopg2 import register_vector
from dotenv import load_dotenv

# 🌟 [에러 해결 핵심] Supabase 모듈 임포트 및 클라이언트 초기화
from supabase import create_client, Client

# 🌟 [추가] 문자열을 임베딩 벡터로 변환하기 위한 Langchain OpenAI 임포트!
from langchain_openai import OpenAIEmbeddings

# .env 환경변수 로드
load_dotenv()

# Supabase 객체 생성 (name 'supabase' is not defined 에러 완벽 차단!)
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
if SUPABASE_URL and SUPABASE_KEY:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
else:
    supabase = None

# 🌟 [자정 리셋의 핵심 1] 기준 시간을 무조건 한국 시간(KST)으로 고정!
KST = ZoneInfo("Asia/Seoul")

# 🌟 [최적화 1] 글로벌 DB 연결 풀 객체
_db_pool = None

def get_pool():
    global _db_pool
    if _db_pool is None:
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            raise ValueError("DATABASE_URL 환경변수가 설정되지 않았습니다.")
        # 최소 1개, 최대 10개의 커넥션을 미리 열어두고 재사용합니다.
        _db_pool = ThreadedConnectionPool(1, 10, db_url)
    return _db_pool


def now_text() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S")


# 🌟 [자정 리셋의 핵심 2] 매일 밤 00:00시가 되면 이 함수가 반환하는 문자열(예: 2026-04-17)이 바뀜!
def today_text() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d")


# 🌟 [최적화 2] 공통 DB 세션 관리자
@contextmanager
def db_session():
    """
    안전한 데이터베이스 연결을 보장하는 컨텍스트 매니저.
    정상 종료 시 commit, 에러 시 rollback 후 연결을 풀에 반납합니다.
    """
    pool = get_pool()
    conn = pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        pool.putconn(conn)


def init_db():
    """모든 테이블 및 인덱스 초기화"""
    with db_session() as conn:
        with conn.cursor() as cur:
            # Vector 익스텐션 활성화
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")

            # 1. 기존 채팅 관련 테이블 생성
            cur.execute("""
                CREATE TABLE IF NOT EXISTS chat_sessions (
                    user_id TEXT PRIMARY KEY,
                    active_thread_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS chat_threads (
                    thread_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS chat_messages (
                    id SERIAL PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    thread_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    message_type TEXT DEFAULT '',
                    created_at TEXT NOT NULL
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS chat_thread_inputs (
                    thread_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    selected_city TEXT NOT NULL DEFAULT '선택하세요',
                    selected_district TEXT NOT NULL DEFAULT '선택하세요',
                    selected_dong TEXT NOT NULL DEFAULT '선택 안 함',
                    birth_year TEXT NOT NULL DEFAULT '',
                    extra_info TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL
                )
            """)
            
            # 🌟 [자정 리셋의 핵심 3] user_id와 usage_date(날짜)를 기준으로 횟수를 따로 저장함
            cur.execute("""
                CREATE TABLE IF NOT EXISTS daily_request_usage (
                    user_id TEXT NOT NULL,
                    usage_date TEXT NOT NULL,
                    request_count INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, usage_date)
                )
            """)

            # 2. 정책 데이터 웨어하우스 테이블 생성 (AI 벡터 검색용)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS policies (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    category TEXT,
                    target_audience TEXT,
                    age_req TEXT,
                    income_req TEXT,
                    region_req TEXT,
                    summary TEXT NOT NULL,
                    url TEXT,
                    deadline TEXT,
                    is_active BOOLEAN DEFAULT TRUE,
                    embedding VECTOR(1536),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)

            # 3. 인덱스 생성
            cur.execute("CREATE INDEX IF NOT EXISTS idx_chat_threads_user_updated ON chat_threads (user_id, updated_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_chat_messages_user_thread_id ON chat_messages (user_id, thread_id, id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_chat_thread_inputs_user_id ON chat_thread_inputs (user_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_daily_request_usage_date ON daily_request_usage (usage_date, updated_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_policies_embedding ON policies USING hnsw (embedding vector_cosine_ops)")


# ==============================================================================
# 정책 데이터 파이프라인 및 RAG 검색 (Phase 2 & 4)
# ==============================================================================

def upsert_policy(policy_data: dict):
    now = now_text()
    policy_id_val = policy_data.get('id', policy_data.get('policy_id'))
    
    with db_session() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO policies (
                    id, title, provider, category, target_audience,
                    age_req, income_req, region_req, summary, url, deadline,
                    embedding, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title,
                    provider = EXCLUDED.provider,
                    category = EXCLUDED.category,
                    target_audience = EXCLUDED.target_audience,
                    age_req = EXCLUDED.age_req,
                    income_req = EXCLUDED.income_req,
                    region_req = EXCLUDED.region_req,
                    summary = EXCLUDED.summary,
                    url = EXCLUDED.url,
                    deadline = EXCLUDED.deadline,
                    embedding = EXCLUDED.embedding,
                    updated_at = EXCLUDED.updated_at,
                    is_active = TRUE
                """,
                (
                    policy_id_val, policy_data.get('title', ''), policy_data.get('provider', ''), 
                    policy_data.get('category', ''), policy_data.get('target_audience', ''),
                    policy_data.get('age_req', ''), policy_data.get('income_req', ''),
                    policy_data.get('region_req', ''), policy_data.get('summary', ''), 
                    policy_data.get('url', ''), policy_data.get('deadline', ''),
                    policy_data.get('embedding'), now, now
                )
            )


# 🌟 [완벽 개조 완료!] tools.py의 요청에 맞게 파라미터(top_k)와 반환값(text)을 맞췄습니다!
def search_policies(query: str, top_k: int = 5) -> str:
    """
    주어진 검색어(query)를 벡터로 변환한 뒤, pgvector DB에서 가장 유사한 정책 top_k개를 찾아
    AI가 읽기 좋은 텍스트(string) 형태로 예쁘게 포매팅하여 반환합니다.
    """
    try:
        # 1. 텍스트 검색어를 벡터 임베딩(숫자 리스트)으로 변환
        # (DB에 저장할 때 썼던 'text-embedding-3-small' 모델과 완벽하게 일치시킴!)
        embeddings = OpenAIEmbeddings(model="text-embedding-3-small")
        query_embedding = embeddings.embed_query(query)
    except Exception as e:
        print(f"❌ 임베딩 변환 오류: {e}")
        return ""

    # 2. 벡터 DB(pgvector) 유사도 검색 실행
    with db_session() as conn:
        register_vector(conn)
        with conn.cursor(cursor_factory=DictCursor) as cur:
            cur.execute(
                """
                SELECT id, title, provider, category, target_audience, 
                       age_req, income_req, region_req, summary, url, deadline
                FROM policies
                WHERE is_active = TRUE
                ORDER BY embedding <=> %s::vector
                LIMIT %s
                """,
                (query_embedding, top_k)
            )
            rows = cur.fetchall()

    # 3. 검색된 결과를 문자열(Text)로 예쁘게 조립해서 tools.py로 넘겨주기
    if not rows:
        return ""

    formatted_results = []
    for p in rows:
        title = p.get('title', '이름 없음')
        provider = p.get('provider', '주관기관 없음')
        summary = p.get('summary', '내용 없음')
        url = p.get('url', '링크 없음')
        formatted_results.append(f"- 정책명: {title} ({provider})\n  내용: {summary}\n  링크: {url}")
    
    return "\n\n".join(formatted_results)


# ==============================================================================
# 채팅 스레드 및 세션 관리 로직
# ==============================================================================

def build_thread_title(content: str, message_type: str) -> str:
    def shorten(text: str, max_len: int = 30) -> str:
        text = " ".join(text.split())
        if len(text) <= max_len:
            return text
        return text[:max_len - 1].rstrip() + "…"

    if message_type == "structured_search":
        region = ""
        extra_info = ""
        for line in content.splitlines():
            line = line.strip()
            if line.startswith("- 거주지:"):
                region = line.split(":", 1)[1].strip()
            elif line.startswith("- 추가 정보:"):
                extra_info = line.split(":", 1)[1].strip()

        if region and extra_info:
            return shorten(f"{region} / {extra_info}")
        if region:
            return shorten(region)

    first_line = ""
    for line in content.splitlines():
        stripped = line.strip()
        if stripped:
            first_line = stripped
            break

    return shorten(first_line) if first_line else "새 대화"


def sanitize_thread_title(title: str) -> str:
    cleaned = " ".join(title.split()).strip()
    if not cleaned:
        return "새 대화"
    return cleaned[:49].rstrip() + "…" if len(cleaned) > 50 else cleaned


def get_default_thread_inputs() -> dict:
    return {
        "selected_city": "선택하세요",
        "selected_district": "선택하세요",
        "selected_dong": "선택 안 함",
        "birth_year": "",
        "extra_info": ""
    }


def ensure_session_row(cur, user_id: str):
    cur.execute("SELECT user_id FROM chat_sessions WHERE user_id = %s", (user_id,))
    if not cur.fetchone():
        now = now_text()
        cur.execute(
            "INSERT INTO chat_sessions (user_id, active_thread_id, created_at, updated_at) VALUES (%s, %s, %s, %s)",
            (user_id, None, now, now)
        )


def thread_exists_for_user(cur, user_id: str, thread_id: str) -> bool:
    cur.execute("SELECT thread_id FROM chat_threads WHERE user_id = %s AND thread_id = %s", (user_id, thread_id))
    return cur.fetchone() is not None


def get_latest_thread_id(cur, user_id: str) -> str:
    cur.execute(
        "SELECT thread_id FROM chat_threads WHERE user_id = %s ORDER BY updated_at DESC, created_at DESC LIMIT 1",
        (user_id,)
    )
    row = cur.fetchone()
    return row["thread_id"] if row else ""


def create_thread(user_id: str, title: str = "새 대화", set_active: bool = True) -> str:
    thread_id = str(uuid.uuid4())
    now = now_text()
    default_inputs = get_default_thread_inputs()

    with db_session() as conn:
        with conn.cursor() as cur:
            ensure_session_row(cur, user_id)
            
            cur.execute(
                "INSERT INTO chat_threads (thread_id, user_id, title, created_at, updated_at) VALUES (%s, %s, %s, %s, %s)",
                (thread_id, user_id, sanitize_thread_title(title), now, now)
            )
            
            cur.execute(
                """
                INSERT INTO chat_thread_inputs 
                (thread_id, user_id, selected_city, selected_district, selected_dong, birth_year, extra_info, updated_at) 
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (thread_id, user_id, default_inputs["selected_city"], default_inputs["selected_district"], 
                 default_inputs["selected_dong"], default_inputs["birth_year"], default_inputs["extra_info"], now)
            )

            if set_active:
                cur.execute("UPDATE chat_sessions SET active_thread_id = %s, updated_at = %s WHERE user_id = %s", (thread_id, now, user_id))
            else:
                cur.execute("UPDATE chat_sessions SET updated_at = %s WHERE user_id = %s", (now, user_id))

    return thread_id


def ensure_user_session(user_id: str) -> str:
    with db_session() as conn:
        with conn.cursor(cursor_factory=DictCursor) as cur:
            ensure_session_row(cur, user_id)
            
            cur.execute("SELECT active_thread_id FROM chat_sessions WHERE user_id = %s", (user_id,))
            session_row = cur.fetchone()
            active_thread_id = session_row["active_thread_id"] if session_row and session_row["active_thread_id"] else ""

            if active_thread_id and thread_exists_for_user(cur, user_id, active_thread_id):
                cur.execute("UPDATE chat_sessions SET updated_at = %s WHERE user_id = %s", (now_text(), user_id))
                return active_thread_id

            latest_thread_id = get_latest_thread_id(cur, user_id)
            if latest_thread_id:
                cur.execute("UPDATE chat_sessions SET active_thread_id = %s, updated_at = %s WHERE user_id = %s", (latest_thread_id, now_text(), user_id))
                return latest_thread_id

    return create_thread(user_id=user_id, title="새 대화", set_active=False)


def set_active_thread(user_id: str, thread_id: str):
    now = now_text()
    with db_session() as conn:
        with conn.cursor() as cur:
            ensure_session_row(cur, user_id)
            if thread_exists_for_user(cur, user_id, thread_id):
                cur.execute("UPDATE chat_sessions SET active_thread_id = %s, updated_at = %s WHERE user_id = %s", (thread_id, now, user_id))


def rename_thread(user_id: str, thread_id: str, new_title: str):
    now = now_text()
    cleaned_title = sanitize_thread_title(new_title)
    with db_session() as conn:
        with conn.cursor() as cur:
            if thread_exists_for_user(cur, user_id, thread_id):
                cur.execute("UPDATE chat_threads SET title = %s, updated_at = %s WHERE user_id = %s AND thread_id = %s", (cleaned_title, now, user_id, thread_id))
                cur.execute("UPDATE chat_sessions SET updated_at = %s WHERE user_id = %s", (now, user_id))


def list_user_threads(user_id: str) -> list:
    with db_session() as conn:
        with conn.cursor(cursor_factory=DictCursor) as cur:
            cur.execute("""
                SELECT t.thread_id, t.title, t.updated_at, COUNT(m.id) AS message_count, 
                       i.selected_city, i.selected_district, i.selected_dong, i.birth_year, i.extra_info
                FROM chat_threads t
                LEFT JOIN chat_messages m ON t.thread_id = m.thread_id AND t.user_id = m.user_id
                LEFT JOIN chat_thread_inputs i ON t.thread_id = i.thread_id AND t.user_id = i.user_id
                WHERE t.user_id = %s
                GROUP BY t.thread_id, t.title, t.updated_at, t.created_at, 
                         i.selected_city, i.selected_district, i.selected_dong, i.birth_year, i.extra_info
                ORDER BY t.updated_at DESC, t.created_at DESC
            """, (user_id,))
            rows = cur.fetchall()

    return [{
        "thread_id": r["thread_id"], "title": r["title"], "updated_at": r["updated_at"], "message_count": r["message_count"],
        "selected_city": r["selected_city"] or "선택하세요", "selected_district": r["selected_district"] or "선택하세요",
        "selected_dong": r["selected_dong"] or "선택 안 함", "birth_year": r["birth_year"] or "", "extra_info": r["extra_info"] or ""
    } for r in rows]


def load_chat_messages(user_id: str, thread_id: str) -> list:
    with db_session() as conn:
        with conn.cursor(cursor_factory=DictCursor) as cur:
            if not thread_exists_for_user(cur, user_id, thread_id):
                return []
            cur.execute("SELECT role, content, message_type FROM chat_messages WHERE user_id = %s AND thread_id = %s ORDER BY id ASC", (user_id, thread_id))
            return [{"role": r["role"], "content": r["content"], "message_type": r["message_type"] or ""} for r in cur.fetchall()]


def save_chat_message(user_id: str, thread_id: str, role: str, content: str, message_type: str = "") -> bool:
    now = now_text()
    with db_session() as conn:
        with conn.cursor(cursor_factory=DictCursor) as cur:
            ensure_session_row(cur, user_id)
            cur.execute("SELECT title FROM chat_threads WHERE user_id = %s AND thread_id = %s", (user_id, thread_id))
            thread_row = cur.fetchone()
            
            if not thread_row:
                return False

            cur.execute(
                "INSERT INTO chat_messages (user_id, thread_id, role, content, message_type, created_at) VALUES (%s, %s, %s, %s, %s, %s)",
                (user_id, thread_id, role, content, message_type, now)
            )

            next_title = thread_row["title"]
            if role == "user" and next_title in ["", "새 대화", "이전 대화"]:
                next_title = build_thread_title(content, message_type)

            cur.execute("UPDATE chat_threads SET title = %s, updated_at = %s WHERE user_id = %s AND thread_id = %s", (next_title, now, user_id, thread_id))
            cur.execute("UPDATE chat_sessions SET updated_at = %s WHERE user_id = %s", (now, user_id))
            
    return True


def save_thread_inputs(user_id: str, thread_id: str, selected_city: str, selected_district: str, selected_dong: str, birth_year: str, extra_info: str) -> bool:
    now = now_text()
    with db_session() as conn:
        with conn.cursor() as cur:
            if not thread_exists_for_user(cur, user_id, thread_id):
                return False

            cur.execute("SELECT thread_id FROM chat_thread_inputs WHERE user_id = %s AND thread_id = %s", (user_id, thread_id))
            
            if cur.fetchone():
                cur.execute("""
                    UPDATE chat_thread_inputs 
                    SET selected_city = %s, selected_district = %s, selected_dong = %s, birth_year = %s, extra_info = %s, updated_at = %s 
                    WHERE user_id = %s AND thread_id = %s
                """, (selected_city, selected_district, selected_dong, birth_year, extra_info, now, user_id, thread_id))
            else:
                cur.execute("""
                    INSERT INTO chat_thread_inputs 
                    (thread_id, user_id, selected_city, selected_district, selected_dong, birth_year, extra_info, updated_at) 
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """, (thread_id, user_id, selected_city, selected_district, selected_dong, birth_year, extra_info, now))
                
    return True


def load_thread_inputs(user_id: str, thread_id: str) -> dict:
    with db_session() as conn:
        with conn.cursor(cursor_factory=DictCursor) as cur:
            if thread_exists_for_user(cur, user_id, thread_id):
                cur.execute("SELECT selected_city, selected_district, selected_dong, birth_year, extra_info FROM chat_thread_inputs WHERE user_id = %s AND thread_id = %s", (user_id, thread_id))
                row = cur.fetchone()
                if row:
                    return {
                        "selected_city": row["selected_city"] or "선택하세요", "selected_district": row["selected_district"] or "선택하세요",
                        "selected_dong": row["selected_dong"] or "선택 안 함", "birth_year": row["birth_year"] or "", "extra_info": row["extra_info"] or ""
                    }
    return get_default_thread_inputs()


def delete_thread(user_id: str, thread_id: str):
    now = now_text()
    with db_session() as conn:
        with conn.cursor(cursor_factory=DictCursor) as cur:
            if not thread_exists_for_user(cur, user_id, thread_id):
                return

            cur.execute("SELECT active_thread_id FROM chat_sessions WHERE user_id = %s", (user_id,))
            session_row = cur.fetchone()
            was_active_thread = bool(session_row and session_row["active_thread_id"] == thread_id)

            cur.execute("DELETE FROM chat_messages WHERE user_id = %s AND thread_id = %s", (user_id, thread_id))
            cur.execute("DELETE FROM chat_thread_inputs WHERE user_id = %s AND thread_id = %s", (user_id, thread_id))
            cur.execute("DELETE FROM chat_threads WHERE user_id = %s AND thread_id = %s", (user_id, thread_id))

            if was_active_thread:
                cur.execute("SELECT thread_id FROM chat_threads WHERE user_id = %s ORDER BY updated_at DESC, created_at DESC LIMIT 1", (user_id,))
                next_row = cur.fetchone()
                next_thread_id = next_row["thread_id"] if next_row else None
                cur.execute("UPDATE chat_sessions SET active_thread_id = %s, updated_at = %s WHERE user_id = %s", (next_thread_id, now, user_id))
            else:
                cur.execute("UPDATE chat_sessions SET updated_at = %s WHERE user_id = %s", (now, user_id))


# 🌟 [신규 추가] 전체 대화 삭제 함수
def delete_all_threads(user_id: str):
    """특정 유저의 모든 대화와 관련 데이터를 싹 다 날려버립니다 🌪️"""
    now = now_text()
    with db_session() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM chat_messages WHERE user_id = %s", (user_id,))
            cur.execute("DELETE FROM chat_thread_inputs WHERE user_id = %s", (user_id,))
            cur.execute("DELETE FROM chat_threads WHERE user_id = %s", (user_id,))
            cur.execute("UPDATE chat_sessions SET active_thread_id = NULL, updated_at = %s WHERE user_id = %s", (now, user_id))


# ==============================================================================
# 사용량 제한 (Quota) 및 통계 관련 로직
# ==============================================================================

def get_daily_request_usage(user_id: str, usage_date: str = "") -> int:
    if not user_id:
        return 0
    target_date = usage_date or today_text()
    with db_session() as conn:
        with conn.cursor(cursor_factory=DictCursor) as cur:
            cur.execute("SELECT request_count FROM daily_request_usage WHERE user_id = %s AND usage_date = %s", (user_id, target_date))
            row = cur.fetchone()
            return int(row["request_count"]) if row else 0


def get_daily_request_status(user_id: str, daily_limit: int) -> dict:
    used = get_daily_request_usage(user_id)
    if daily_limit <= 0:
        return { "daily_limit": daily_limit, "used": used, "remaining": None, "allowed": True, "usage_date": today_text() }
    
    remaining = max(daily_limit - used, 0)
    return { "daily_limit": daily_limit, "used": used, "remaining": remaining, "allowed": remaining > 0, "usage_date": today_text() }


# 🌟 [자정 리셋 작동 원리]
# target_date = today_text()를 통해 현재 KST 기준의 '날짜(YYYY-MM-DD)'를 구합니다.
# 00시 00분이 되면 이 날짜 텍스트가 변경되므로, DB에서 조회(SELECT) 시 기록이 없다고 판단하여 
# 카운트가 0에서부터 자동으로 다시 시작됩니다! (완벽한 구조 💯)
def consume_daily_request_quota(user_id: str, daily_limit: int) -> dict:
    if not user_id:
        return { "allowed": False, "daily_limit": daily_limit, "used": 0, "remaining": 0 if daily_limit > 0 else None, "usage_date": today_text() }

    target_date = today_text()
    now = now_text()

    with db_session() as conn:
        with conn.cursor(cursor_factory=DictCursor) as cur:
            ensure_session_row(cur, user_id)
            cur.execute("SELECT request_count FROM daily_request_usage WHERE user_id = %s AND usage_date = %s", (user_id, target_date))
            row = cur.fetchone()
            current_count = int(row["request_count"]) if row else 0

            if daily_limit > 0 and current_count >= daily_limit:
                return { "allowed": False, "daily_limit": daily_limit, "used": current_count, "remaining": 0, "usage_date": target_date }

            next_count = current_count + 1
            if row:
                cur.execute("UPDATE daily_request_usage SET request_count = %s, updated_at = %s WHERE user_id = %s AND usage_date = %s", (next_count, now, user_id, target_date))
            else:
                cur.execute("INSERT INTO daily_request_usage (user_id, usage_date, request_count, created_at, updated_at) VALUES (%s, %s, %s, %s, %s)", (user_id, target_date, next_count, now, now))

    return { "allowed": True, "daily_limit": daily_limit, "used": next_count, "remaining": max(daily_limit - next_count, 0) if daily_limit > 0 else None, "usage_date": target_date }


def refund_daily_request_quota(user_id: str, usage_date: str = "") -> bool:
    if not user_id:
        return False

    target_date = usage_date or today_text()
    with db_session() as conn:
        with conn.cursor(cursor_factory=DictCursor) as cur:
            cur.execute("SELECT request_count FROM daily_request_usage WHERE user_id = %s AND usage_date = %s", (user_id, target_date))
            row = cur.fetchone()
            if not row or int(row["request_count"]) <= 0:
                return False

            cur.execute("UPDATE daily_request_usage SET request_count = request_count - 1, updated_at = %s WHERE user_id = %s AND usage_date = %s", (now_text(), user_id, target_date))
            return True


# 🌟 [신규 추가] 관리자 대시보드를 위한 고급 통계 추출
def get_admin_dashboard_stats() -> dict:
    today = today_text()
    current_year = datetime.now(KST).year

    with db_session() as conn:
        with conn.cursor(cursor_factory=DictCursor) as cur:
            # 1. 기본 수치 (유저 수, 대화방 수, 차단 수)
            cur.execute("SELECT COUNT(DISTINCT user_id) as total_users FROM chat_sessions")
            total_users = cur.fetchone()["total_users"] or 0
            
            cur.execute("SELECT COUNT(*) as total_threads FROM chat_threads")
            total_threads = cur.fetchone()["total_threads"] or 0
            
            cur.execute("SELECT COUNT(*) as blocked_today FROM daily_request_usage WHERE usage_date = %s AND request_count >= 4", (today,))
            blocked_today = cur.fetchone()["blocked_today"] or 0

            # 2. 📍 지역별 랭킹 (Top 5)
            cur.execute("""
                SELECT selected_city, selected_district, COUNT(*) as count
                FROM chat_thread_inputs
                WHERE selected_city != '선택하세요' AND selected_city != ''
                GROUP BY selected_city, selected_district
                ORDER BY count DESC
                LIMIT 5
            """)
            region_ranking = [{"name": f"{r['selected_city']} {r['selected_district']}".strip(), "value": r["count"]} for r in cur.fetchall()]

            # 3. 🎂 연령대 분포 (10대 ~ 60대 이상)
            cur.execute("""
                SELECT birth_year
                FROM chat_thread_inputs
                WHERE birth_year ~ '^[0-9]{4}$'
            """)
            age_counts = {}
            for row in cur.fetchall():
                by = int(row['birth_year'])
                age = current_year - by
                if age < 20: group = "10대 이하"
                elif age < 30: group = "20대"
                elif age < 40: group = "30대"
                elif age < 50: group = "40대"
                elif age < 60: group = "50대"
                else: group = "60대 이상"
                age_counts[group] = age_counts.get(group, 0) + 1
            age_distribution = [{"name": k, "value": v} for k, v in sorted(age_counts.items(), key=lambda x: x[0])]

            # 4. ⚔️ 대화 깊이 (평균 티키타카 횟수)
            cur.execute("""
                SELECT AVG(msg_count) as avg_depth
                FROM (
                    SELECT thread_id, COUNT(*) as msg_count
                    FROM chat_messages
                    GROUP BY thread_id
                ) sub
            """)
            avg_depth_row = cur.fetchone()
            avg_depth = round(float(avg_depth_row["avg_depth"]), 1) if avg_depth_row and avg_depth_row["avg_depth"] else 0

            # 5. 🕒 시간대별 트래픽 집중도
            cur.execute("""
                SELECT SUBSTR(created_at, 12, 2) as hour, COUNT(*) as count
                FROM chat_messages
                GROUP BY hour
                ORDER BY hour ASC
            """)
            time_traffic = [{"hour": f"{r['hour']}시", "count": r["count"]} for r in cur.fetchall()]

            # 6. 🔥 인기 키워드 분석 (추가 정보에서 핵심 단어 추출)
            cur.execute("SELECT extra_info FROM chat_thread_inputs WHERE extra_info != ''")
            keyword_freq = {}
            stop_words = {"입니다", "합니다", "있음", "없음", "어떻게", "찾아주세요", "알려주세요"}
            for row in cur.fetchall():
                text = row['extra_info']
                words = text.split()
                for w in words:
                    # 특수문자 제거 후 순수 텍스트만 추출
                    w_clean = "".join(filter(str.isalnum, w))
                    if len(w_clean) > 1 and w_clean not in stop_words:
                        keyword_freq[w_clean] = keyword_freq.get(w_clean, 0) + 1
            
            top_keywords = [{"keyword": k, "count": v} for k, v in sorted(keyword_freq.items(), key=lambda item: item[1], reverse=True)[:10]]

    return {
        "today_date": today,
        "total_users": total_users,
        "total_threads": total_threads,
        "blocked_today": blocked_today,
        "avg_conversation_depth": avg_depth,
        "region_ranking": region_ranking,
        "age_distribution": age_distribution,
        "time_traffic": time_traffic,
        "top_keywords": top_keywords
    }
