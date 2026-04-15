import os
import json
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
REQUEST_TIMEOUT_SECONDS = 60


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
            st.cache_data.clear()  # 새 대화 생성 시 목록 갱신을 위해 캐시 초기화
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
        else:
            st.cache_data.clear()  # 제목 변경 반영을 위해 캐시 초기화
    except Exception as e:
        st.error(f"API 연결 차단됨 (rename_thread): {e}")


# 💡 [최적화] 대화 목록 1분간 캐싱
@st.cache_data(ttl=60)
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


# 💡 [최적화] 대화 입력값 1분간 캐싱
@st.cache_data(ttl=60)
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
        else:
            st.cache_data.clear()  # 대화 삭제 시 목록 갱신을 위해 캐시 초기화
    except Exception as e:
        st.error(f"API 연결 차단됨 (delete_thread): {e}")


def api_save_inputs(user_id: str, thread_id: str, inputs: dict):
    try:
        payload = {"user_id": user_id, **inputs}
        res = _request("POST", f"/threads/{thread_id}/inputs", json=payload)
        if res.status_code != 200:
            st.error(f"입력값 저장 서버 에러: {res.status_code} - {res.text}")
        else:
            st.cache_data.clear()  # 입력값 캐시 갱신
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
        # AI 답변은 타임아웃 90초 유지, 실시간이 중요하므로 캐싱 제외
        res = _request("POST", "/chat", json=payload, timeout=90)
        if res.status_code == 200:
            st.cache_data.clear()  # 메시지 추가 후 대화목록 카운트 갱신을 위해 비움
            return res.json().get("answer", "응답을 파싱할 수 없습니다.")
        raise Exception(f"서버 통신 오류: {res.status_code} - {res.text}")
    except Exception as e:
        raise Exception(f"클라우드 API 통신 실패: {e}")


# 🌟 [신규 추가] 실시간 타자 효과를 위한 스트리밍 전용 함수
def api_get_ai_response_stream(user_id, thread_id, city, district, dong, birth_year, extra_info, query=None):
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
    
    base_url = get_api_base_url()
    # ⚠️ 백엔드 엔드포인트 주의: 백엔드가 스트리밍을 /chat/stream 에서 주는지, /chat 에서 주는지 확인하세요.
    url = f"{base_url}/chat/stream" 

    try:
        # stream=True 옵션으로 파이프라인 개방
        response = requests.post(url, json=payload, stream=True, timeout=90)
        response.raise_for_status()

        # 데이터가 한 줄씩 날아올 때마다 바로바로 던져줌(yield)
        for line in response.iter_lines():
            if line:
                decoded_line = line.decode('utf-8')
                
                # SSE 형식의 'data: ' 접두사 제거
                if decoded_line.startswith("data: "):
                    decoded_line = decoded_line[6:]

                try:
                    data = json.loads(decoded_line)
                    chunk_type = data.get('type')

                    # 백엔드에서 'content' 타입으로 보낸 글자만 화면에 출력
                    if chunk_type == 'content':
                        yield data.get('delta', '')
                        
                    # 백엔드에서 'status' 타입으로 보낸 진행 상황 메시지 처리 (옵션)
                    elif chunk_type == 'status':
                        # st.write_stream은 yield 받은 문자열을 화면에 합치므로,
                        # 상태 메시지도 원한다면 아래처럼 보낼 수 있습니다.
                        # yield f"\n_{data.get('message', '')}_\n"
                        pass # 지금은 깔끔하게 글자만 출력하도록 패스!

                except json.JSONDecodeError:
                    continue # JSON 파싱 에러 시 무시하고 다음 진행
                    
        # 스트리밍 통신이 완벽하게 종료되면 캐시 초기화
        st.cache_data.clear()
        
    except Exception as e:
        yield f"\n\n[스트리밍 연결 오류 발생: {e}]"
