import os
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo
from contextlib import contextmanager

import psycopg2
from psycopg2.extras import DictCursor
from dotenv import load_dotenv

# .env 파일에서 DATABASE_URL 등 환경변수 불러오기
load_dotenv()

KST = ZoneInfo("Asia/Seoul")


def now_text() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S")


def today_text() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d")


@contextmanager
def db_session():
    """
    PostgreSQL 데이터베이스 연결을 관리하는 컨텍스트 매니저입니다.
    작업이 성공하면 자동으로 commit 하고, 에러가 나면 rollback 한 뒤 연결을 닫습니다.
    """
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise ValueError("DATABASE_URL 환경변수가 설정되지 않았습니다. .env 파일을 확인해 주세요.")
    
    conn = psycopg2.connect(db_url)
    try:
        yield conn
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()


def init_db():
    """
    Supabase(PostgreSQL)에 필요한 테이블과 인덱스를 생성합니다.
    (기존 SQLite의 AUTOINCREMENT 대신 PostgreSQL의 SERIAL을 사용합니다)
    """
    with db_session() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS chat_sessions (
                    user_id TEXT PRIMARY KEY,
                    active_thread_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )

            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS chat_threads (
                    thread_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )

            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS chat_messages (
                    id SERIAL PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    thread_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    message_type TEXT DEFAULT '',
                    created_at TEXT NOT NULL
                )
                """
            )

            cur.execute(
                """
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
                """
            )

            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS daily_request_usage (
                    user_id TEXT NOT NULL,
                    usage_date TEXT NOT NULL,
                    request_count INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, usage_date)
                )
                """
            )

            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_chat_threads_user_updated
                ON chat_threads (user_id, updated_at DESC)
                """
            )

            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_chat_messages_user_thread_id
                ON chat_messages (user_id, thread_id, id)
                """
            )

            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_chat_thread_inputs_user_id
                ON chat_thread_inputs (user_id)
                """
            )

            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_daily_request_usage_date
                ON daily_request_usage (usage_date, updated_at DESC)
                """
            )


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

    if not first_line:
        return "새 대화"

    return shorten(first_line)


def sanitize_thread_title(title: str) -> str:
    cleaned = " ".join(title.split()).strip()

    if not cleaned:
        return "새 대화"

    if len(cleaned) > 50:
        return cleaned[:49].rstrip() + "…"

    return cleaned


def get_default_thread_inputs() -> dict:
    return {
        "selected_city": "선택하세요",
        "selected_district": "선택하세요",
        "selected_dong": "선택 안 함",
        "birth_year": "",
        "extra_info": ""
    }


def ensure_session_row(cur, user_id: str):
    cur.execute(
        """
        SELECT user_id
        FROM chat_sessions
        WHERE user_id = %s
        """,
        (user_id,)
    )
    row = cur.fetchone()

    if row:
        return

    now = now_text()

    cur.execute(
        """
        INSERT INTO chat_sessions (
            user_id, active_thread_id, created_at, updated_at
        )
        VALUES (%s, %s, %s, %s)
        """,
        (user_id, None, now, now)
    )


def thread_exists_for_user(cur, user_id: str, thread_id: str) -> bool:
    cur.execute(
        """
        SELECT thread_id
        FROM chat_threads
        WHERE user_id = %s AND thread_id = %s
        """,
        (user_id, thread_id)
    )
    row = cur.fetchone()

    return row is not None


def get_latest_thread_id(cur, user_id: str) -> str:
    cur.execute(
        """
        SELECT thread_id
        FROM chat_threads
        WHERE user_id = %s
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
        """,
        (user_id,)
    )
    row = cur.fetchone()

    if not row:
        return ""

    return row["thread_id"]


def create_thread(user_id: str, title: str = "새 대화", set_active: bool = True) -> str:
    thread_id = str(uuid.uuid4())
    now = now_text()
    default_inputs = get_default_thread_inputs()

    with db_session() as conn:
        with conn.cursor() as cur:
            ensure_session_row(cur, user_id)

            cur.execute(
                """
                INSERT INTO chat_threads (
                    thread_id, user_id, title, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s)
                """,
                (thread_id, user_id, sanitize_thread_title(title), now, now)
            )

            cur.execute(
                """
                INSERT INTO chat_thread_inputs (
                    thread_id, user_id, selected_city, selected_district,
                    selected_dong, birth_year, extra_info, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    thread_id,
                    user_id,
                    default_inputs["selected_city"],
                    default_inputs["selected_district"],
                    default_inputs["selected_dong"],
                    default_inputs["birth_year"],
                    default_inputs["extra_info"],
                    now
                )
            )

            if set_active:
                cur.execute(
                    """
                    UPDATE chat_sessions
                    SET active_thread_id = %s, updated_at = %s
                    WHERE user_id = %s
                    """,
                    (thread_id, now, user_id)
                )
            else:
                cur.execute(
                    """
                    UPDATE chat_sessions
                    SET updated_at = %s
                    WHERE user_id = %s
                    """,
                    (now, user_id)
                )

    return thread_id


def ensure_user_session(user_id: str) -> str:
    with db_session() as conn:
        with conn.cursor(cursor_factory=DictCursor) as cur:
            ensure_session_row(cur, user_id)

            cur.execute(
                """
                SELECT active_thread_id
                FROM chat_sessions
                WHERE user_id = %s
                """,
                (user_id,)
            )
            session_row = cur.fetchone()

            active_thread_id = (session_row["active_thread_id"] or "") if session_row else ""

            if active_thread_id and thread_exists_for_user(cur, user_id, active_thread_id):
                cur.execute(
                    """
                    UPDATE chat_sessions
                    SET updated_at = %s
                    WHERE user_id = %s
                    """,
                    (now_text(), user_id)
                )
                return active_thread_id

            latest_thread_id = get_latest_thread_id(cur, user_id)

            if latest_thread_id:
                cur.execute(
                    """
                    UPDATE chat_sessions
                    SET active_thread_id = %s, updated_at = %s
                    WHERE user_id = %s
                    """,
                    (latest_thread_id, now_text(), user_id)
                )
                return latest_thread_id

    return create_thread(user_id=user_id, title="새 대화", set_active=False)


def set_active_thread(user_id: str, thread_id: str):
    now = now_text()

    with db_session() as conn:
        with conn.cursor() as cur:
            ensure_session_row(cur, user_id)

            if not thread_exists_for_user(cur, user_id, thread_id):
                return

            cur.execute(
                """
                UPDATE chat_sessions
                SET active_thread_id = %s, updated_at = %s
                WHERE user_id = %s
                """,
                (thread_id, now, user_id)
            )


def rename_thread(user_id: str, thread_id: str, new_title: str):
    now = now_text()
    cleaned_title = sanitize_thread_title(new_title)

    with db_session() as conn:
        with conn.cursor() as cur:
            if not thread_exists_for_user(cur, user_id, thread_id):
                return

            cur.execute(
                """
                UPDATE chat_threads
                SET title = %s, updated_at = %s
                WHERE user_id = %s AND thread_id = %s
                """,
                (cleaned_title, now, user_id, thread_id)
            )

            cur.execute(
                """
                UPDATE chat_sessions
                SET updated_at = %s
                WHERE user_id = %s
                """,
                (now, user_id)
            )


def list_user_threads(user_id: str) -> list:
    with db_session() as conn:
        with conn.cursor(cursor_factory=DictCursor) as cur:
            cur.execute(
                """
                SELECT
                    t.thread_id,
                    t.title,
                    t.updated_at,
                    COUNT(m.id) AS message_count,
                    i.selected_city,
                    i.selected_district,
                    i.selected_dong,
                    i.birth_year,
                    i.extra_info
                FROM chat_threads t
                LEFT JOIN chat_messages m
                    ON t.thread_id = m.thread_id
                    AND t.user_id = m.user_id
                LEFT JOIN chat_thread_inputs i
                    ON t.thread_id = i.thread_id
                    AND t.user_id = i.user_id
                WHERE t.user_id = %s
                GROUP BY
                    t.thread_id, t.title, t.updated_at, t.created_at,
                    i.selected_city, i.selected_district, i.selected_dong, i.birth_year, i.extra_info
                ORDER BY t.updated_at DESC, t.created_at DESC
                """,
                (user_id,)
            )
            rows = cur.fetchall()

    threads = []
    for row in rows:
        threads.append({
            "thread_id": row["thread_id"],
            "title": row["title"],
            "updated_at": row["updated_at"],
            "message_count": row["message_count"],
            "selected_city": row["selected_city"] or "선택하세요",
            "selected_district": row["selected_district"] or "선택하세요",
            "selected_dong": row["selected_dong"] or "선택 안 함",
            "birth_year": row["birth_year"] or "",
            "extra_info": row["extra_info"] or ""
        })

    return threads


def load_chat_messages(user_id: str, thread_id: str) -> list:
    with db_session() as conn:
        with conn.cursor(cursor_factory=DictCursor) as cur:
            if not thread_exists_for_user(cur, user_id, thread_id):
                return []

            cur.execute(
                """
                SELECT role, content, message_type
                FROM chat_messages
                WHERE user_id = %s AND thread_id = %s
                ORDER BY id ASC
                """,
                (user_id, thread_id)
            )
            rows = cur.fetchall()

    messages = []
    for row in rows:
        messages.append({
            "role": row["role"],
            "content": row["content"],
            "message_type": row["message_type"] or ""
        })

    return messages


def save_chat_message(
    user_id: str,
    thread_id: str,
    role: str,
    content: str,
    message_type: str = ""
):
    now = now_text()

    with db_session() as conn:
        with conn.cursor(cursor_factory=DictCursor) as cur:
            ensure_session_row(cur, user_id)

            cur.execute(
                """
                SELECT title
                FROM chat_threads
                WHERE user_id = %s AND thread_id = %s
                """,
                (user_id, thread_id)
            )
            thread_row = cur.fetchone()

            if not thread_row:
                return False

            current_title = thread_row["title"]

            cur.execute(
                """
                INSERT INTO chat_messages (
                    user_id, thread_id, role, content, message_type, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (user_id, thread_id, role, content, message_type, now)
            )

            next_title = current_title
            if role == "user" and current_title in ["", "새 대화", "이전 대화"]:
                next_title = build_thread_title(content, message_type)

            cur.execute(
                """
                UPDATE chat_threads
                SET title = %s, updated_at = %s
                WHERE user_id = %s AND thread_id = %s
                """,
                (next_title, now, user_id, thread_id)
            )

            cur.execute(
                """
                UPDATE chat_sessions
                SET updated_at = %s
                WHERE user_id = %s
                """,
                (now, user_id)
            )

    return True


def save_thread_inputs(
    user_id: str,
    thread_id: str,
    selected_city: str,
    selected_district: str,
    selected_dong: str,
    birth_year: str,
    extra_info: str
):
    now = now_text()

    with db_session() as conn:
        with conn.cursor() as cur:
            if not thread_exists_for_user(cur, user_id, thread_id):
                return False

            cur.execute(
                """
                SELECT thread_id
                FROM chat_thread_inputs
                WHERE user_id = %s AND thread_id = %s
                """,
                (user_id, thread_id)
            )
            existing_row = cur.fetchone()

            if existing_row:
                cur.execute(
                    """
                    UPDATE chat_thread_inputs
                    SET
                        selected_city = %s,
                        selected_district = %s,
                        selected_dong = %s,
                        birth_year = %s,
                        extra_info = %s,
                        updated_at = %s
                    WHERE user_id = %s AND thread_id = %s
                    """,
                    (
                        selected_city,
                        selected_district,
                        selected_dong,
                        birth_year,
                        extra_info,
                        now,
                        user_id,
                        thread_id
                    )
                )
            else:
                cur.execute(
                    """
                    INSERT INTO chat_thread_inputs (
                        thread_id, user_id, selected_city, selected_district,
                        selected_dong, birth_year, extra_info, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        thread_id,
                        user_id,
                        selected_city,
                        selected_district,
                        selected_dong,
                        birth_year,
                        extra_info,
                        now
                    )
                )

    return True


def load_thread_inputs(user_id: str, thread_id: str) -> dict:
    with db_session() as conn:
        with conn.cursor(cursor_factory=DictCursor) as cur:
            if not thread_exists_for_user(cur, user_id, thread_id):
                return get_default_thread_inputs()

            cur.execute(
                """
                SELECT selected_city, selected_district, selected_dong, birth_year, extra_info
                FROM chat_thread_inputs
                WHERE user_id = %s AND thread_id = %s
                """,
                (user_id, thread_id)
            )
            row = cur.fetchone()

    if not row:
        return get_default_thread_inputs()

    return {
        "selected_city": row["selected_city"] or "선택하세요",
        "selected_district": row["selected_district"] or "선택하세요",
        "selected_dong": row["selected_dong"] or "선택 안 함",
        "birth_year": row["birth_year"] or "",
        "extra_info": row["extra_info"] or ""
    }


def delete_thread(user_id: str, thread_id: str):
    now = now_text()

    with db_session() as conn:
        with conn.cursor(cursor_factory=DictCursor) as cur:
            if not thread_exists_for_user(cur, user_id, thread_id):
                return

            cur.execute(
                """
                SELECT active_thread_id
                FROM chat_sessions
                WHERE user_id = %s
                """,
                (user_id,)
            )
            session_row = cur.fetchone()
            was_active_thread = bool(session_row and session_row["active_thread_id"] == thread_id)

            cur.execute("DELETE FROM chat_messages WHERE user_id = %s AND thread_id = %s", (user_id, thread_id))
            cur.execute("DELETE FROM chat_thread_inputs WHERE user_id = %s AND thread_id = %s", (user_id, thread_id))
            cur.execute("DELETE FROM chat_threads WHERE user_id = %s AND thread_id = %s", (user_id, thread_id))

            if was_active_thread:
                cur.execute(
                    """
                    SELECT thread_id
                    FROM chat_threads
                    WHERE user_id = %s
                    ORDER BY updated_at DESC, created_at DESC
                    LIMIT 1
                    """,
                    (user_id,)
                )
                next_row = cur.fetchone()
                next_thread_id = next_row["thread_id"] if next_row else None

                cur.execute(
                    """
                    UPDATE chat_sessions
                    SET active_thread_id = %s, updated_at = %s
                    WHERE user_id = %s
                    """,
                    (next_thread_id, now, user_id)
                )
            else:
                cur.execute(
                    """
                    UPDATE chat_sessions
                    SET updated_at = %s
                    WHERE user_id = %s
                    """,
                    (now, user_id)
                )


def get_daily_request_usage(user_id: str, usage_date: str = "") -> int:
    if not user_id:
        return 0

    target_date = usage_date or today_text()

    with db_session() as conn:
        with conn.cursor(cursor_factory=DictCursor) as cur:
            cur.execute(
                """
                SELECT request_count
                FROM daily_request_usage
                WHERE user_id = %s AND usage_date = %s
                """,
                (user_id, target_date)
            )
            row = cur.fetchone()

    if not row:
        return 0

    return int(row["request_count"] or 0)


def get_daily_request_status(user_id: str, daily_limit: int) -> dict:
    used = get_daily_request_usage(user_id)

    if daily_limit <= 0:
        return {
            "daily_limit": daily_limit,
            "used": used,
            "remaining": None,
            "allowed": True,
            "usage_date": today_text(),
        }

    remaining = max(daily_limit - used, 0)
    return {
        "daily_limit": daily_limit,
        "used": used,
        "remaining": remaining,
        "allowed": remaining > 0,
        "usage_date": today_text(),
    }


def consume_daily_request_quota(user_id: str, daily_limit: int) -> dict:
    if not user_id:
        return {
            "allowed": False,
            "daily_limit": daily_limit,
            "used": 0,
            "remaining": 0 if daily_limit > 0 else None,
            "usage_date": today_text(),
        }

    target_date = today_text()
    now = now_text()

    with db_session() as conn:
        with conn.cursor(cursor_factory=DictCursor) as cur:
            ensure_session_row(cur, user_id)
            cur.execute(
                """
                SELECT request_count
                FROM daily_request_usage
                WHERE user_id = %s AND usage_date = %s
                """,
                (user_id, target_date)
            )
            row = cur.fetchone()

            current_count = int(row["request_count"] or 0) if row else 0

            if daily_limit > 0 and current_count >= daily_limit:
                return {
                    "allowed": False,
                    "daily_limit": daily_limit,
                    "used": current_count,
                    "remaining": 0,
                    "usage_date": target_date,
                }

            next_count = current_count + 1

            if row:
                cur.execute(
                    """
                    UPDATE daily_request_usage
                    SET request_count = %s, updated_at = %s
                    WHERE user_id = %s AND usage_date = %s
                    """,
                    (next_count, now, user_id, target_date)
                )
            else:
                cur.execute(
                    """
                    INSERT INTO daily_request_usage (
                        user_id, usage_date, request_count, created_at, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (user_id, target_date, next_count, now, now)
                )

    remaining = None if daily_limit <= 0 else max(daily_limit - next_count, 0)
    return {
        "allowed": True,
        "daily_limit": daily_limit,
        "used": next_count,
        "remaining": remaining,
        "usage_date": target_date,
    }


def refund_daily_request_quota(user_id: str, usage_date: str = "") -> bool:
    if not user_id:
        return False

    target_date = usage_date or today_text()
    now = now_text()

    with db_session() as conn:
        with conn.cursor(cursor_factory=DictCursor) as cur:
            cur.execute(
                """
                SELECT request_count
                FROM daily_request_usage
                WHERE user_id = %s AND usage_date = %s
                """,
                (user_id, target_date)
            )
            row = cur.fetchone()

            if not row:
                return False

            current_count = int(row["request_count"] or 0)
            if current_count <= 0:
                return False

            next_count = current_count - 1

            cur.execute(
                """
                UPDATE daily_request_usage
                SET request_count = %s, updated_at = %s
                WHERE user_id = %s AND usage_date = %s
                """,
                (next_count, now, user_id, target_date)
            )

    return True