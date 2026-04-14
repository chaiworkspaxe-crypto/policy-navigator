import os
import requests
from dotenv import load_dotenv

# 1. 환경 변수 로드
load_dotenv()

# 2. 인증키 가져오기
# Render에 등록한 'PUBLIC_DATA_PORTAL_KEY'를 가져옵니다.
PUBLIC_DATA_KEY = os.getenv("PUBLIC_DATA_PORTAL_KEY")

# 보조금24 API 엔드포인트
BOJOGEUM_URL = "https://api.odcloud.kr/api/gov24/v3/publicServiceList"

def fetch_data():
    print("🚀 보조금24 데이터 수집을 시도합니다...")
    
    if not PUBLIC_DATA_KEY:
        print("❌ 에러: 환경변수에서 API 키를 찾을 수 없습니다.")
        return

    # 공공데이터포털 API의 정석 파라미터 세팅
    params = {
        "page": 1,
        "perPage": 10,
        "serviceKey": PUBLIC_DATA_KEY, # 인증키
        "returnType": "JSON"           # 응답 형식을 JSON으로 명시
    }

    try:
        # 인증키에 특수문자가 섞여있을 경우를 대비해 직접 URL을 구성하는 대신 params 활용
        response = requests.get(BOJOGEUM_URL, params=params, timeout=10)
        
        # 400 에러가 나면 여기서 멈추고 에러 내용을 출력해줍니다.
        if response.status_code == 400:
            print("⚠️ 서버에서 400 에러를 보냈습니다. 키가 아직 활성화되지 않았을 수 있습니다.")
            print(f"상세 메시지: {response.text}")
            return

        response.raise_for_status()
        data = response.json()
        
        if "data" in data:
            policies = data["data"]
            print(f"✅ 총 {len(policies)}개의 정책 데이터를 성공적으로 가져왔습니다!")
            for p in policies:
                print(f"- {p.get('서비스명')}")
        else:
            print("⚠️ 데이터 구조가 예상과 다릅니다.")
            print(data)

    except Exception as e:
        print(f"❌ 오류 발생: {e}")

if __name__ == "__main__":
    fetch_data()
