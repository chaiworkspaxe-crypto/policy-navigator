import os
import requests
from dotenv import load_dotenv

# 1. 로컬 환경 변수 로드 (.env 파일 읽기)
load_dotenv()

# 2. API 키 및 DB 설정 가져오기
PUBLIC_DATA_KEY = os.getenv("PUBLIC_DATA_PORTAL_KEY")

# 보조금24 API 엔드포인트 (공공데이터포털 표준)
BOJOGEUM_URL = "https://api.odcloud.kr/api/gov24/v3/publicServiceList"

def fetch_bojogeum24_data():
    print("🚀 보조금24 데이터 수집을 시작합니다...")
    
    if not PUBLIC_DATA_KEY:
        print("❌ 에러: PUBLIC_DATA_PORTAL_KEY가 설정되지 않았습니다.")
        return

    # API 요청 파라미터 세팅
    params = {
        "page": 1,
        "perPage": 10, # 우선 테스트로 10개만 가져와 봅니다
        "serviceKey": PUBLIC_DATA_KEY
    }

    try:
        response = requests.get(BOJOGEUM_URL, params=params)
        response.raise_for_status() # 에러 발생 시 예외 처리
        
        data = response.json()
        
        # 응답 데이터 확인
        if "data" in data:
            policies = data["data"]
            print(f"✅ 총 {len(policies)}개의 정책 데이터를 성공적으로 가져왔습니다!\n")
            
            for idx, policy in enumerate(policies, 1):
                title = policy.get('서비스명', '이름 없음')
                agency = policy.get('소관기관명', '기관 없음')
                target = policy.get('지원대상', '조건 없음')
                
                print(f"[{idx}] {title} ({agency})")
                print(f" - 대상: {target[:50]}...\n")
                
            # TODO: 여기에 Supabase DB에 데이터를 삽입하는 코드를 추가합니다.
            # db.table("policies").insert({...}).execute()
            
        else:
            print("⚠️ 데이터를 찾을 수 없습니다. 응답 형태를 확인해주세요.")
            print(data)

    except requests.exceptions.RequestException as e:
        print(f"❌ API 요청 중 에러가 발생했습니다: {e}")

if __name__ == "__main__":
    fetch_bojogeum24_data()
