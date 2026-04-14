import os
import time
import requests
from supabase import create_client, Client
from dotenv import load_dotenv

# 1. 환경 변수 로드
load_dotenv()

# 2. 인증키 및 DB 설정 가져오기
PUBLIC_DATA_KEY = os.getenv("PUBLIC_DATA_PORTAL_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

# 보조금24 API 엔드포인트
BOJOGEUM_URL = "https://api.odcloud.kr/api/gov24/v3/serviceList"

# 3. Supabase 클라이언트 초기화
supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def sync_to_supabase(policies):
    """가져온 데이터를 Supabase DB에 저장하는 함수"""
    if not supabase:
        print("❌ 에러: Supabase 환경변수(URL 또는 KEY)가 설정되지 않았습니다.")
        return False

    formatted_data = []
    for p in policies:
        formatted_data.append({
            "id": p.get("서비스ID"),             # 고유 ID로 중복 체크
            "title": p.get("서비스명", "이름 없음"),
            "agency": p.get("소관기관명", "기관 없음"),
            "description": p.get("지원대상", ""),
            "category": p.get("서비스분야", ""),
            "link": p.get("상세조회URL", "")
        })

    try:
        # Upsert: 기존에 있으면 덮어쓰기(업데이트), 없으면 새로 생성
        supabase.table("policies").upsert(
            formatted_data, 
            on_conflict="id"
        ).execute()
        return True
    except Exception as e:
        print(f"❌ DB 저장 중 오류 발생: {e}")
        return False

def fetch_all_data():
    print("🚀 [실전 모드] 보조금24 전체 데이터 수집 및 DB 동기화 시작...")
    
    if not PUBLIC_DATA_KEY:
        print("❌ 에러: 환경변수에서 API 키를 찾을 수 없습니다.")
        return

    headers = {
        "accept": "application/json",
        "Authorization": f"Infuser {PUBLIC_DATA_KEY}"
    }

    page = 1
    per_page = 100  # 한 번에 100개씩 큼직하게 가져옵니다.
    total_saved = 0

    # 무한 루프: 데이터가 더 이상 없을 때까지 페이지를 넘기며 계속 가져옴
    while True:
        print(f"🔄 {page}페이지 (총 {per_page}개씩) 수집 요청 중...")
        
        params = {
            "page": page,
            "perPage": per_page,
            "serviceKey": PUBLIC_DATA_KEY,
            "returnType": "JSON"
        }

        try:
            response = requests.get(BOJOGEUM_URL, headers=headers, params=params, timeout=15)
            
            if response.status_code == 400:
                print("⚠️ 서버에서 400 에러를 보냈습니다. 키가 만료되었거나 제한에 걸렸을 수 있습니다.")
                break

            response.raise_for_status()
            data = response.json()
            
            # 응답에서 정책 리스트를 꺼냄
            policies = data.get("data", [])
            
            # 만약 가져온 데이터가 0개라면? = 마지막 페이지까지 다 긁어왔다는 뜻!
            if len(policies) == 0:
                print("🏁 더 이상 가져올 데이터가 없습니다. 전체 수집 완료!")
                break
                
            print(f"✅ {page}페이지에서 {len(policies)}개의 데이터를 찾았습니다. DB에 저장합니다...")
            
            # DB 저장 함수 호출
            is_success = sync_to_supabase(policies)
            
            if is_success:
                total_saved += len(policies)
            else:
                print("⚠️ DB 저장 실패로 인해 작업을 중단합니다.")
                break

            # 💡 핵심: 정부 서버에 무리가 가지 않도록(차단 방지) 1초 쉬어줍니다.
            time.sleep(1)
            
            # 다음 페이지로 이동
            page += 1

        except Exception as e:
            print(f"❌ 통신 오류 발생: {e}")
            break

    print(f"\n🎉 [최종 성공] 총 {total_saved}개의 정책 데이터가 우리 DB에 완벽하게 동기화되었습니다! 🎉")

if __name__ == "__main__":
    fetch_all_data()
