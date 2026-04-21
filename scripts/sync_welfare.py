import os
import time
import requests
from supabase import create_client, Client
from dotenv import load_dotenv

# 🌟 [추가] 텍스트를 벡터로 변환하기 위한 임포트
from langchain_openai import OpenAIEmbeddings

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
        # 🌟 중요: DB 컬럼명과 API 필드명을 1:1로 정확히 매핑함
        formatted_data.append({
            "id": p.get("서비스ID"),
            "title": p.get("서비스명", "이름 없음"),
            "provider": p.get("소관기관명", "기관 없음"), # ✅ DB 컬럼명 일치
            "summary": p.get("지원대상", ""),           # ✅ DB 컬럼명 일치
            "category": p.get("서비스분야", ""),
            "url": p.get("상세조회URL", ""),             # 🌟 link도 url로 통일
            "updated_at": "now()"
        })

    # =================================================================
    # 🔥 [핵심 추가] DB에 넣기 전에 OpenAI로 텍스트를 임베딩(벡터) 변환!
    # =================================================================
    try:
        print(f"🤖 OpenAI API로 {len(formatted_data)}개 정책 내용을 임베딩(벡터) 변환 중...")
        embeddings = OpenAIEmbeddings(model="text-embedding-3-small")
        
        # 벡터로 변환할 텍스트 덩어리 만들기 (매칭률을 높이기 위해 핵심 정보 총집합)
        texts_to_embed = [
            f"정책명: {data['title']} 주관: {data['provider']} 카테고리: {data['category']} 내용: {data['summary']}" 
            for data in formatted_data
        ]
        
        # 텍스트 리스트를 한 방에 벡터 숫자로 변환 (돈/시간 절약)
        vectors = embeddings.embed_documents(texts_to_embed)
        
        # 변환된 벡터를 formatted_data 에 'embedding' 이라는 키로 쏙쏙 집어넣기
        for i, data in enumerate(formatted_data):
            data["embedding"] = vectors[i]
            
    except Exception as e:
        print(f"❌ 임베딩 변환 실패! (OpenAI API 키 확인 필요): {e}")
        return False
    # =================================================================

    try:
        # Upsert: id가 같으면 덮어쓰고, 없으면 새로 생성
        # on_conflict="id"를 통해 중복 저장을 방지함
        supabase.table("policies").upsert(
            formatted_data, 
            on_conflict="id"
        ).execute()
        return True
    except Exception as e:
        print(f"❌ DB 저장 중 오류 발생 (컬럼명을 다시 확인하세요): {e}")
        return False

def fetch_all_data():
    print("🚀 [실전 모드] 보조금24 전체 데이터 수집 및 DB 동기화 시작...")
    
    if not PUBLIC_DATA_KEY:
        print("❌ 에러: 환경변수에서 API 키를 찾을 수 없습니다.")
        return

    # 공공데이터포털 인증 헤더
    headers = {
        "accept": "application/json",
        "Authorization": f"Infuser {PUBLIC_DATA_KEY}"
    }

    page = 1
    per_page = 100  # 한 번에 100개씩 효율적으로 수집
    total_saved = 0

    while True:
        print(f"\n🔄 {page}페이지 (총 {per_page}개씩) 수집 요청 중...")
        
        params = {
            "page": page,
            "perPage": per_page,
            "serviceKey": PUBLIC_DATA_KEY,
            "returnType": "JSON"
        }

        try:
            response = requests.get(BOJOGEUM_URL, headers=headers, params=params, timeout=15)
            
            if response.status_code == 400:
                print("⚠️ 서버에서 400 에러를 보냈습니다. API 키나 파라미터를 확인하세요.")
                break

            response.raise_for_status()
            data = response.json()
            
            # 응답 데이터 리스트 추출
            policies = data.get("data", [])
            
            # 더 이상 가져올 데이터가 없으면 루프 종료
            if not policies:
                print("🏁 모든 데이터를 긁어왔습니다. 수집을 종료합니다!")
                break
                
            print(f"✅ {page}페이지에서 {len(policies)}개의 데이터를 찾았습니다. DB로 전송 중...")
            
            # Supabase에 저장 (임베딩 포함)
            is_success = sync_to_supabase(policies)
            
            if is_success:
                total_saved += len(policies)
                print(f"✨ 현재까지 총 {total_saved}개 저장 완료")
            else:
                print("⚠️ DB 저장 단계에서 실패했습니다. 작업을 중단합니다.")
                break

            # 💡 서버 부하 방지를 위한 1.2초 휴식 (매우 중요!)
            time.sleep(1.2)
            
            page += 1

        except Exception as e:
            print(f"❌ 통신 중 오류 발생: {e}")
            break

    print(f"\n🎉 [최종 결과] 총 {total_saved}개의 정책 데이터가 임베딩과 함께 DB에 동기화되었습니다!")

if __name__ == "__main__":
    fetch_all_data()
