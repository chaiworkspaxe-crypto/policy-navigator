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

# 보조금24 API 엔드포인트
BOJOGEUM_URL = "https://api.odcloud.kr/api/gov24/v3/serviceList"

# 3. Supabase 클라이언트 초기화
supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def cleanup_zombie_policies(total_saved):
    """업데이트 된 지 3일 이상 지난(API에서 사라진) 마감 정책을 DB에서 삭제합니다."""
    
    # 🌟 [초강력 안전장치] API가 고장나서 데이터를 못 가져왔을 때는 절대 청소하지 않음!
    if total_saved < 100:
        print("⚠️ [안전장치 작동] 오늘 수집된 데이터가 너무 적어 청소를 생략합니다. (API 서버 확인 필요)")
        return

    print("🧹 [청소 닌자 출동] 마감된 좀비 정책 데이터 삭제를 시작합니다...")
    
    if not supabase:
        return
        
    try:
        from datetime import datetime, timedelta
        three_days_ago = (datetime.utcnow() - timedelta(days=3)).isoformat()
        
        # 3일 이상 업데이트 안 된 데이터 삭제
        response = supabase.table("policies").delete().lt("updated_at", three_days_ago).execute()
        
        deleted_count = len(response.data) if response.data else 0
        print(f"✨ [청소 완료] 총 {deleted_count}개의 마감/예산소진 정책이 DB에서 영구 삭제되었습니다!")
        
    except Exception as e:
        print(f"❌ 청소 중 오류 발생: {e}")

def sync_to_supabase(policies):
    """가져온 데이터를 Supabase DB에 저장하는 함수"""
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

    # 🔥 [핵심 추가] DB에 넣기 전에 OpenAI로 텍스트를 임베딩(벡터) 변환!
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

    # 🌟 [초강력 타임아웃 방지] 5개씩 아주 잘게 쪼개서 넣기! (옛날 100개 코드는 삭제함)
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
            
            # DB가 인덱스를 갱신할 시간을 충분히 주기 위해 2초 휴식!
            time.sleep(2)
            
        return True
        
    except Exception as e:
        print(f"❌ DB 조각 저장 중 오류 발생: {e}")
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
    per_page = 100
    total_saved = 0

    while True:
        print(f"\n🔄 {page}페이지 (총 {per_page}개씩) 수집 요청 중...")
        
        params = {
            "page": page,
            "perPage": per_page,
            "serviceKey": PUBLIC_DATA_KEY,
            "returnType": "JSON"
        }

        # ==============================================================================
        # 🌟 [시니어의 비법 적용] API 통신 실패 시 좀비처럼 살아나는 Retry 로직 추가!
        # ==============================================================================
        max_retries = 3
        fetch_success = False
        data = None
        fatal_error = False

        for attempt in range(max_retries):
            try:
                # 타임아웃 45초로 넉넉하게 연장!
                response = requests.get(BOJOGEUM_URL, headers=headers, params=params, timeout=45)
                
                if response.status_code == 400:
                    print("⚠️ 서버에서 400 에러를 보냈습니다. API 키나 파라미터를 확인하세요.")
                    fatal_error = True
                    break  # 400 에러는 재시도해도 안 되니까 즉시 포기

                response.raise_for_status()
                data = response.json()
                fetch_success = True
                break  # 🌟 성공하면 재시도 루프(for문) 즉시 탈출!

            except requests.exceptions.RequestException as e:
                print(f"⚠️ API 통신 오류 발생 (시도 횟수: {attempt + 1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    print("⏳ 5초 뒤에 다시 찔러봅니다...")
                    time.sleep(5)  # 5초 숨 고르고 다시 요청
                else:
                    print(f"❌ 3번이나 재시도했지만 {page}페이지 수집에 실패했습니다. 이 페이지는 건너뜁니다.")

        # ==============================================================================

        if fatal_error:
            break  # 전체 반복문(while문) 종료

        if not fetch_success or not data:
            page += 1
            continue  # 에러 난 페이지는 스킵하고 다음 페이지(page + 1)로 쿨하게 넘어감!

        policies = data.get("data", [])
        
        if not policies:
            print("🏁 모든 데이터를 긁어왔습니다. 수집을 종료합니다!")
            break
            
        print(f"✅ {page}페이지에서 {len(policies)}개의 데이터를 찾았습니다. DB로 전송 중...")
        
        is_success = sync_to_supabase(policies)
        
        if is_success:
            total_saved += len(policies)
            print(f"✨ 현재까지 총 {total_saved}개 저장 완료")
        else:
            print("⚠️ DB 저장 단계에서 실패했습니다. 작업을 중단합니다.")
            break

        time.sleep(1.2)
        page += 1

    print(f"\n🎉 [최종 결과] 총 {total_saved}개의 정책 데이터가 임베딩과 함께 DB에 동기화되었습니다!")
    
    # 🌟 수집이 다 끝난 직후에 좀비 데이터 청소 닌자 실행!
    cleanup_zombie_policies(total_saved)

if __name__ == "__main__":
    fetch_all_data()
