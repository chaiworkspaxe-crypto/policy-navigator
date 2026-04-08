import os

import requests
import streamlit as st
from dotenv import load_dotenv

# Windows / requests SSL 인증 문제 대응
try:
    import truststore
    truststore.inject_into_ssl()
except Exception:
    pass

load_dotenv()

DEFAULT_API_BASE_URL = "https://policy-navigator-1.onrender.com"
REQUEST_TIMEOUT_SECONDS = 30


def get_api_base_url() -> str:
    return (
        os.getenv("POLICY_NAVIGATOR_API_BASE_URL", "").strip()
        or os.getenv("API_BASE_URL", "").strip()
        or DEFAULT_API_BASE_URL
    ).rstrip("/")


def _request(method: str, path: str, *, params=None, json=None, timeout: int = REQUEST_TIMEOUT_SECONDS):
    base_url = get_api_base_url()
    url = f"{base_url}{path}"
    return requests.request(method=method, url=url, params=params, json=json, timeout=timeout)


def api_create_thread(user_id: str) -> str:
    try:
        res = _request("POST", "/threads", json={"user_id": user_id})
        if res.status_code == 200:
            return res.json().get("thread_id", "")
        st.error(f"대화 생성 서버 에러: {res.status_code} - {res.text}")
    except Exception as e:
        st.error(f"API 연결 차단됨 (create_thread): {e}")
    return ""


def api_rename_thread(user_id: str, thread_id: str, title: str):
    try:
        res = _request("PATCH", f"/threads/{thread_id}", json={"user_id": user_id, "title": title})
        if res.status_code != 200:
            st.error(f"대화 제목 변경 서버 에러: {res.status_code} - {res.text}")
    except Exception as e:
        st.error(f"API 연결 차단됨 (rename_thread): {e}")


def api_list_threads(user_id: str) -> list:
    try:
        res = _request("GET", "/threads", params={"user_id": user_id})
        if res.status_code == 200:
            return res.json().get("threads", [])
        st.error(f"목록 불러오기 서버 에러: {res.status_code} - {res.text}")
    except Exception as e:
        st.error(f"API 연결 차단됨 (list_threads): {e}")
    return []


def api_load_messages(user_id: str, thread_id: str) -> list:
    try:
        res = _request("GET", f"/threads/{thread_id}/messages", params={"user_id": user_id})
        if res.status_code == 200:
            return res.json().get("messages", [])
        st.error(f"메시지 불러오기 서버 에러: {res.status_code} - {res.text}")
    except Exception as e:
        st.error(f"API 연결 차단됨 (load_messages): {e}")
    return []


def api_load_inputs(user_id: str, thread_id: str) -> dict:
    try:
        res = _request("GET", f"/threads/{thread_id}/inputs", params={"user_id": user_id})
        if res.status_code == 200:
            return res.json().get("inputs", {})
        st.error(f"입력값 불러오기 서버 에러: {res.status_code} - {res.text}")
    except Exception as e:
        st.error(f"API 연결 차단됨 (load_inputs): {e}")
    return {}


def api_delete_thread(user_id: str, thread_id: str):
    try:
        res = _request("DELETE", f"/threads/{thread_id}", params={"user_id": user_id})
        if res.status_code != 200:
            st.error(f"대화 삭제 서버 에러: {res.status_code} - {res.text}")
    except Exception as e:
        st.error(f"API 연결 차단됨 (delete_thread): {e}")


def api_save_inputs(user_id: str, thread_id: str, inputs: dict):
    try:
        payload = {"user_id": user_id, **inputs}
        res = _request("POST", f"/threads/{thread_id}/inputs", json=payload)
        if res.status_code != 200:
            st.error(f"입력값 저장 서버 에러: {res.status_code} - {res.text}")
    except Exception as e:
        st.error(f"API 연결 차단됨 (save_inputs): {e}")


def api_get_ai_response(user_id, thread_id, city, district, dong, birth_year, extra_info, query=None) -> str:
    payload = {
        "user_id": user_id,
        "thread_id": thread_id,
        "city": city,
        "district": district,
        "dong": dong,
        "birth_year": birth_year,
        "extra_info": extra_info,
        "query": query,
    }
    try:
        res = _request("POST", "/chat", json=payload, timeout=90)
        if res.status_code == 200:
            return res.json().get("answer", "응답을 파싱할 수 없습니다.")
        raise Exception(f"서버 통신 오류: {res.status_code} - {res.text}")
    except Exception as e:
        raise Exception(f"클라우드 API 통신 실패: {e}")
