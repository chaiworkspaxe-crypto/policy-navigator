import os
import time
import requests
from supabase import create_client, Client
from dotenv import load_dotenv

# 1. 환경 변수 로드
load_dotenv()

# 2. 인증키 및 DB 설정
PUBLIC_API_KEY = os.getenv("PUBLIC_DATA_PORTAL_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

# 공공데이터포털 보조금24 API 엔드포인트
WELFARE_API_URL = "https://api.odcloud.kr/api/gov24/v1/serviceList"

supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def sync_to_supabase(policies):
    if not supabase:
        return False

    formatted_data = []
    for p in policies:
        formatted_data.append({
            "id": p.get("SVC_ID", ""),                       
            "title": p.get("SVC_NM", "이름 없음"),      
            "provider": p.get("JRSCT_INSTT_NM", "정부/지자체"),  
            "category": "일반복지",          
            "target_audience": p.get("TRGTER_INDVDL_NMArray", ""), 
            "age_req": "",                
            "income_req": "",                               
            "region_req": "",              
            "summary": p.get("SVC_PVSN_CN", "내용 없음"),       
            "url": p.get("SVC_DTL_LINK", ""),                   
            "deadline": "상시 (상세페이지 참조)",             
            "is_active": True,                              
            "updated_at": "now()"                           
        })

    try:
        supabase.table("policies").upsert(formatted_data, on_conflict="id").execute()
        return True
    except Exception as e:
        print(f"❌ DB 저장 오류: {e}")
        return False

def fetch_welfare_data():
    print("🚀 [일반복지 파이프라인] 보조금24 데이터 수집 시작...")
    
    if not PUBLIC_API_KEY:
        print("⚠️ PUBLIC_DATA_PORTAL_KEY가 없어 수집을 건너뜁니다. (.env 확인)")
        return

    page = 1
    per_page = 100
    total_saved = 0

    while True:
        print(f"🔄 일반복지 {page}페이지 수집 중...")
        
        # 🌟 1. 파이썬의 이중 인코딩 방지를 위한 URL 직접 조립
        url = f"{WELFARE_API_URL}?page={page}&perPage={per_page}&serviceKey={PUBLIC_API_KEY}"
        
        # 🌟 2. odcloud 전용 헤더 인증 장착
        headers = {
            "accept": "application/json",
            "Authorization": PUBLIC_API_KEY
        }

        try:
            # 파라미터(params)를 빼고 URL과 헤더로 다이렉트 통신
            response = requests.get(url, headers=headers, timeout=15)
            response.raise_for_status()
            
            data = response.json()
            items = data.get("data", [])
            
            if not items:
                break
                
            if sync_to_supabase(items):
                total_saved += len(items)
            else:
                break

            time.sleep(1.0)
            page += 1

        except Exception as e:
            print(f"❌ API 통신 오류: {e}")
            break

    print(f"🎉 [일반복지 파이프라인] 총 {total_saved}개 동기화 완료!\n")

if __name__ == "__main__":
    fetch_welfare_data()
