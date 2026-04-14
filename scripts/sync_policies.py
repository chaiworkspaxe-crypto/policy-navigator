import os
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

# 3. Supabase 클라이언트 초기화 (설정값이 있을 때만)
supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def sync_to_supabase(policies):
    """가져온 데이터를 Supabase DB에 저장하는 함수"""
    if not supabase:
        print("❌ 에러: Supabase 환경변수(URL 또는 KEY)가 설정되지 않았습니다.")
        return

    print(f"💾 {len(policies)}개의 데이터를 DB에 저장 시도 중...")
    
    formatted_data = []
    for p in policies:
        # DB 컬럼명에 맞춰 정부 API 데이터 매핑 (없는 데이터는 빈 문자열 처리)
        formatted_data.append({
            "id": p.get("서비스ID"),             # 고유 ID로 중복 체크 기준이 됨
            "title": p.get("서비스명", "이름 없음"),
            "agency": p.get("소관기관명", "기관 없음"),
            "description": p.get("지원대상", ""),
            "category": p.get("서비스분야", ""),
            "link": p.get("상세조회URL", "")
        })

    try:
        # Upsert 실행: id가 같으면 덮어쓰고, 없으면 새로 생성
        response = supabase.table("policies").upsert(
            formatted_data, 
            on_conflict="id"
        ).execute()
        print("✅ DB 동기화 완전 성공! (Supabase 대시보드에서 확인해보세요 🎉)")
    except Exception as e:
        print(f"❌ DB 저장 중 오류 발생: {e}")

def fetch_data():
    print("🚀 보조금24 데이터 수집 및 DB 동기화 시작...")
    
    if not PUBLIC_DATA_KEY:
        print("❌ 에러: 환경변수에서 API 키를 찾을 수 없습니다.")
        return

    # api.odcloud.kr 서버의 공식 인증 방식인 Header
    headers = {
        "accept": "application/json",
        "Authorization": f"Infuser {PUBLIC_DATA_KEY}"
    }

    params = {
        "page": 1,
        "perPage": 10, # 일단 10개만 테스트! 나중에 이걸 100이나 1000으로 늘리면 돼.
        "serviceKey": PUBLIC_DATA_KEY,
        "returnType": "JSON"
    }

    try:
        response = requests.get(BOJOGEUM_URL, headers=headers, params=params, timeout=10)
        
        if response.status_code == 400:
            print("⚠️ 서버에서 400 에러를 보냈습니다.")
            print(f"상세 메시지: {response.text}")
            return

        response.raise_for_status()
        data = response.json()
        
        if "data" in data:
            policies = data["data"]
            print(f"\n✅ 정부 서버에서 총 {len(policies)}개의 정책 데이터를 가져왔습니다!")
            
            # 여기서 화면에 출력하는 대신 DB 저장 함수로 데이터를 넘겨줍니다.
            sync_to_supabase(policies)
        else:
            print("⚠️ 데이터는 왔는데 예상한 구조가 아닙니다.")
            print(data)

    except Exception as e:
        print(f"❌ 오류 발생: {e}")

if __name__ == "__main__":
    fetch_data()
