import os
import requests
from dotenv import load_dotenv

# 1. 환경 변수 로드
load_dotenv()

# 2. 인증키 가져오기
PUBLIC_DATA_KEY = os.getenv("PUBLIC_DATA_PORTAL_KEY")

# 🚨 문제의 원인이었던 URL 오타 수정 (publicServiceList -> serviceList)
BOJOGEUM_URL = "https://api.odcloud.kr/api/gov24/v3/serviceList"

def fetch_data():
    print("🚀 보조금24 데이터 수집을 시도합니다...")
    
    if not PUBLIC_DATA_KEY:
        print("❌ 에러: 환경변수에서 API 키를 찾을 수 없습니다.")
        return

    # 💡 api.odcloud.kr 서버의 공식 인증 방식인 Header 추가 (가장 안정적임!)
    headers = {
        "accept": "application/json",
        "Authorization": f"Infuser {PUBLIC_DATA_KEY}"
    }

    params = {
        "page": 1,
        "perPage": 10,
        "serviceKey": PUBLIC_DATA_KEY, # 헤더에도 넣고 여기도 넣어서 이중 체크
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
        
        # 'data'라는 키 안에 정책 목록이 들어있음
        if "data" in data:
            policies = data["data"]
            print(f"\n✅ 대성공! 총 {len(policies)}개의 정책 데이터를 가져왔습니다!\n")
            for idx, p in enumerate(policies, 1):
                # 서비스명과 소관기관명을 출력
                title = p.get('서비스명', '이름 없음')
                agency = p.get('소관기관명', '기관 없음')
                print(f"[{idx}] {title} ({agency})")
        else:
            print("⚠️ 데이터는 왔는데 예상한 구조가 아닙니다.")
            print(data)

    except Exception as e:
        print(f"❌ 오류 발생: {e}")

if __name__ == "__main__":
    fetch_data()
