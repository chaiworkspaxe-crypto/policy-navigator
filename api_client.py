import requests
import os
import streamlit as st

# 클라우드에 배포된 네 API 주소 (끝에 슬래시(/) 없이 작성!)
API_BASE_URL = "https://policy-navigator-1.onrender.com"

def api_list_threads(user_id: str):
    try:
        res = requests.get(f"{API_BASE_URL}/threads", params={"user_id": user_id})
        if res.status_code == 200:
            return res.json().get("threads", [])
    except Exception as e:
        st.error(f"서버 연결 오류: {e}")
    return []

def api_create_thread(user_id: str):
    res = requests.post(f"{API_BASE_URL}/threads", params={"user_id": user_id})
    if res.status_code == 200:
        return res.json().get("thread_id")
    return None

def api_load_messages(user_id: str, thread_id: str):
    res = requests.get(f"{API_BASE_URL}/threads/{thread_id}/messages", params={"user_id": user_id})
    if res.status_code == 200:
        return res.json().get("messages", [])
    return []

def api_delete_thread(user_id: str, thread_id: str):
    requests.delete(f"{API_BASE_URL}/threads/{thread_id}", params={"user_id": user_id})

def api_rename_thread(user_id: str, thread_id: str, title: str):
    requests.patch(f"{API_BASE_URL}/threads/{thread_id}", json={"user_id": user_id, "title": title})

def api_chat(user_id, thread_id, city, district, dong, birth_year, extra_info, query=None):
    payload = {
        "user_id": user_id,
        "thread_id": thread_id,
        "city": city,
        "district": district,
        "dong": dong,
        "birth_year": birth_year,
        "extra_info": extra_info,
        "query": query
    }
    res = requests.post(f"{API_BASE_URL}/chat", json=payload)
    if res.status_code == 200:
        return res.json()
    else:
        raise Exception(f"AI 응답 오류: {res.text}")