import os
import time
import requests
from supabase import create_client, Client
from dotenv import load_dotenv
from langchain_openai import OpenAIEmbeddings

# 1. 환경 변수 로드
load_dotenv()

# 2. 인증키 및 DB 설정 가져오기
PUBLIC_DATA_KEY = os.getenv("PUBLIC_DATA_PORTAL_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

# 🌟 보조금24 및 복지로 API 엔드포인트 세팅
BOJOGEUM_URL = "https://api.odcloud.kr/api/gov24/v3/serviceList"
BOKJIRO_URL = "http://apis.data.go.kr/B554287/NationalWelfareInformations/NationalWelfatedata"

# 3. Supabase 클라이언트 초기화
supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def cleanup_zombie_policies(total_saved):
    """업데이트 된 지 3일 이상 지난(API에서 사라진) 마감 정책을 DB에서 삭제합니다."""
    
    if total_saved < 100:
        print("⚠️ [안전장치 작동] 오늘 수집된 데이터가 너무 적어 청소를 생략합니다. (API 서버 확인 필요)")
        return

    print("🧹 [청소 닌자 출동] 마감된 좀비 정책 데이터 삭제를 시작합니다...")
    
    if not supabase:
        return
        
    try:
        from datetime import datetime, timedelta
        three_days_ago = (datetime.utcnow() - timedelta(days=3)).isoformat()
        
        response = supabase.table("policies").delete().lt("updated_at", three_days_ago).execute()
        
        deleted_count = len(response.data) if response.data else 0
        print(f"✨ [청소 완료] 총 {deleted_count}개의 마감/예산소진 정책이 DB에서 영구 삭제되었습니다!")
        
    except Exception as e:
        print(f"❌ 청소 중 오류 발생: {e}")

def sync_to_supabase(policies):
    """가져온 데이터를 Supabase DB에 저장하는 함수 (보조금24, 복지로 공용)"""
    if not supabase:
        print("❌ 에러: Supabase 환경변수(URL 또는 KEY)가 설정되지 않았습니다.")
        return False

    formatted_data = []
    for p in policies:
        formatted_data.append({
            "id": p.get("서비스ID"),
            "title": p.get("서비스명", "이름 없음"),
            "provider": p.get("소관기관명", "기관 없음"),
            "summary": p.get("지원대상", ""),
            "category": p.get("서비스분야", ""),
            "url": p.get("상세조회URL", ""),
            "updated_at": "now()"
        })

    try:
        print(f"🤖 OpenAI API로 {len(formatted_data)}개 정책 내용을 임베딩(벡터) 변환 중...")
        embeddings = OpenAIEmbeddings(model="text-embedding-3-small")
        
        texts_to_embed = [
            f"정책명: {data['title']} 주관: {data['provider']} 카테고리: {data['category']} 내용: {data['summary']}" 
            for data in formatted_data
        ]
        
        vectors = embeddings.embed_documents(texts_to_embed)
        
        for i, data in enumerate(formatted_data):
            data["embedding"] = vectors[i]
            
    except Exception as e:
        print(f"❌ 임베딩 변환 실패! (OpenAI API 키 확인 필요): {e}")
        return False

    CHUNK_SIZE = 5  
    total_data = len(formatted_data)
    
    try:
        for i in range(0, total_data, CHUNK_SIZE):
            chunk = formatted_data[i : i + CHUNK_SIZE]
            
            supabase.table("policies").upsert(
                chunk, 
                on_conflict="id"
            ).execute()
            
            print(f"    ㄴ 조각 저장 완료: {min(i + CHUNK_SIZE, total_data)} / {total_data}")
            time.sleep(2)
            
        return True
        
    except Exception as e:
        print(f"❌ DB 조각 저장 중 오류 발생: {e}")
        return False

# ==============================================================================
# 🟢 1. 보조금24 데이터 수집 함수
# ==============================================================================
def fetch_bojogeum24_data() -> int:
    print("\n🚀 [STAGE 1] 보조금24 데이터 수집을 시작합니다...")
    headers = { "accept": "application/json", "Authorization": f"Infuser {PUBLIC_DATA_KEY}" }
    page = 1
    per_page = 100
    saved_count = 0

    while True:
        print(f"🔄 보조금24 - {page}페이지 수집 요청 중...")
        params = { "page": page, "perPage": per_page, "serviceKey": PUBLIC_DATA_KEY, "returnType": "JSON" }
        
        max_retries = 3
        fetch_success = False
        data = None
        fatal_error = False

        for attempt in range(max_retries):
            try:
                response = requests.get(BOJOGEUM_URL, headers=headers, params=params, timeout=45)
                if response.status_code == 400:
                    print("⚠️ 서버에서 400 에러를 보냈습니다. 즉시 포기합니다.")
                    fatal_error = True
                    break
                response.raise_for_status()
                data = response.json()
                fetch_success = True
                break
            except requests.exceptions.RequestException as e:
                print(f"⚠️ API 오류 (시도: {attempt + 1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    time.sleep(5)
                else:
                    print(f"❌ {page}페이지 수집 실패. 건너뜁니다.")

        if fatal_error: break
        if not fetch_success or not data:
            page += 1; continue

        policies = data.get("data", [])
        if not policies:
            print("🏁 보조금24 데이터를 모두 긁어왔습니다!")
            break
            
        is_success = sync_to_supabase(policies)
        if is_success: saved_count += len(policies)
        else: break

        time.sleep(1.2)
        page += 1

    return saved_count

# ==============================================================================
# 🔵 2. 복지로 데이터 수집 함수 (신규 추가!)
# ==============================================================================
def fetch_bokjiro_data() -> int:
    print("\n🚀 [STAGE 2] 복지로 데이터 수집을 시작합니다...")
    page = 1
    per_page = 100
    saved_count = 0

    while True:
        print(f"🔄 복지로 - {page}페이지 수집 요청 중...")
        
        # 복지로 API 파라미터 (공공데이터포털 복지로 규격 기준)
        params = {
            "serviceKey": PUBLIC_DATA_KEY,
            "pageNo": page,
            "numOfRows": per_page,
            "callTp": "L",       # 목록 조회
            "returnType": "json" # JSON 응답 요청 (지원하는 경우)
        }
        
        max_retries = 3
        fetch_success = False
        data = None
        fatal_error = False

        for attempt in range(max_retries):
            try:
                # URL 인코딩 이슈를 막기 위해 그대로 넘김
                response = requests.get(BOKJIRO_URL, params=params, timeout=45)
                if response.status_code == 400:
                    fatal_error = True
                    break
                response.raise_for_status()
                data = response.json()
                fetch_success = True
                break
            except Exception as e:
                print(f"⚠️ API 오류 (시도: {attempt + 1}/{max_retries}): {e}")
                if attempt < max_retries - 1: time.sleep(5)

        if fatal_error: break
        if not fetch_success or not data:
            page += 1; continue

        # 🌟 복지로 JSON 구조를 파싱 (복지로 구조에 맞춤)
        # 통상적으로 복지로는 data["servList"] 형태로 내려줍니다.
        # 만약 실제 응답 키가 다르면 아래 "servList" 부분을 수정해 주면 돼!
        raw_policies = data.get("servList", [])
        
        if not raw_policies:
            print("🏁 복지로 데이터를 모두 긁어왔습니다!")
            break

        # 🌟 복지로 데이터를 보조금24 규격에 맞게 변환 (어댑터 역할)
        mapped_policies = []
        for p in raw_policies:
            mapped_policies.append({
                "서비스ID": p.get("servId", ""),
                "서비스명": p.get("servNm", ""),
                "소관기관명": p.get("jurMnofNm", "복지로"),
                "지원대상": p.get("trgterIndvdlArray", ""), # 또는 tgdcrCn
                "서비스분야": p.get("intrsThemaArray", ""),
                "상세조회URL": p.get("servDtlLink", "")
            })
            
        # 규격이 똑같아졌으니 기존 함수(sync_to_supabase)에 그대로 던지면 끝!
        is_success = sync_to_supabase(mapped_policies)
        if is_success: saved_count += len(mapped_policies)
        else: break

        time.sleep(1.2)
        page += 1

    return saved_count

# ==============================================================================
# 🌟 메인 오케스트레이터 (전체 지휘자)
# ==============================================================================
def fetch_all_data():
    print("🚀 [전체 파이프라인 가동] 보조금24 + 복지로 DB 동기화 시작...")
    
    if not PUBLIC_DATA_KEY:
        print("❌ 에러: 환경변수에서 API 키를 찾을 수 없습니다.")
        return

    # 1. 보조금24 수집
    bojogeum_total = fetch_bojogeum24_data()
    
    # 2. 복지로 수집
    bokjiro_total = fetch_bokjiro_data()
    
    # 3. 최종 결산 및 청소
    total_saved = bojogeum_total + bokjiro_total
    print(f"\n🎉 [최종 결산] 보조금24({bojogeum_total}개) + 복지로({bokjiro_total}개) = 총 {total_saved}개 동기화 완료!")
    
    cleanup_zombie_policies(total_saved)

if __name__ == "__main__":
    fetch_all_data()
