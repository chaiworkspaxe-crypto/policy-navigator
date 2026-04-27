import os
import time
import requests
import hashlib # 🌟 데이터 지문(Hash)을 만들기 위한 필수 라이브러리
import urllib.parse # 🌟 [핵심 추가] 복지로 API 키 이중 인코딩 방지용
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
    if not supabase: return
        
    try:
        from datetime import datetime, timedelta
        three_days_ago = (datetime.utcnow() - timedelta(days=3)).isoformat()
        
        response = supabase.table("policies").delete().lt("updated_at", three_days_ago).execute()
        
        deleted_count = len(response.data) if response.data else 0
        print(f"✨ [청소 완료] 총 {deleted_count}개의 마감/예산소진 정책이 DB에서 영구 삭제되었습니다!")
    except Exception as e:
        print(f"❌ 청소 중 오류 발생: {e}")

# ==============================================================================
# 🌟 [핵심 수술 1&2] 지문 필터링(비용 절감) + DB 불사조 로직 융합!
# ==============================================================================
def sync_to_supabase(policies):
    if not supabase:
        print("❌ 에러: Supabase 환경변수(URL 또는 KEY)가 설정되지 않았습니다.")
        return False

    formatted_data = []
    api_ids = []

    # 1️⃣ 데이터 규격화 및 '디지털 지문(Hash)' 생성
    for p in policies:
        pid = p.get("서비스ID") or p.get("id", "")
        title = p.get("서비스명") or p.get("title", "이름 없음")
        provider = p.get("소관기관명") or p.get("provider", "기관 없음")
        summary = p.get("지원대상") or p.get("summary", "")
        category = p.get("서비스분야") or p.get("category", "")
        url = p.get("상세조회URL") or p.get("url", "")

        # 텍스트를 뭉쳐서 하나의 '지문' 생성
        content_str = f"{title}{provider}{category}{summary}"
        content_hash = hashlib.md5(content_str.encode('utf-8')).hexdigest()

        formatted_data.append({
            "id": pid,
            "title": title,
            "provider": provider,
            "summary": summary,
            "category": category,
            "url": url,
            "content_hash": content_hash, # Supabase에 추가한 새 컬럼!
            "updated_at": "now()"
        })
        if pid: api_ids.append(pid)

    # 2️⃣ Supabase DB에서 기존 지문 훑어오기
    db_hash_map = {}
    if api_ids:
        try:
            existing_records = supabase.table("policies").select("id, content_hash").in_("id", api_ids).execute()
            db_hash_map = {record["id"]: record.get("content_hash") for record in existing_records.data}
        except Exception as e:
            print(f"⚠️ DB 지문 조회 에러 (일단 전부 업데이트합니다): {e}")

    # 3️⃣ 새 데이터 or 내용이 바뀐 데이터만 필터링
    needs_embedding = []
    for data in formatted_data:
        pid = data["id"]
        api_hash = data["content_hash"]
        if pid not in db_hash_map or db_hash_map[pid] != api_hash:
            needs_embedding.append(data)

    # 4️⃣ 변경된 게 없다면 무료 패스!
    if not needs_embedding:
        print(f"    ⏩ {len(policies)}개 중 변경된 데이터 없음. (비용 0원 스킵!)")
        return True # 문제없이 스킵한 것도 '성공' 처리

    # 5️⃣ 골라낸 데이터만 OpenAI 결제(임베딩) 진행
    print(f"🤖 {len(policies)}개 중 변경된 {len(needs_embedding)}개만 임베딩 변환 중...")
    try:
        embeddings = OpenAIEmbeddings(model="text-embedding-3-small")
        texts_to_embed = [
            f"정책명: {d['title']} 주관: {d['provider']} 카테고리: {d['category']} 내용: {d['summary']}" 
            for d in needs_embedding
        ]
        vectors = embeddings.embed_documents(texts_to_embed)
        
        for i, d in enumerate(needs_embedding):
            d["embedding"] = vectors[i]
    except Exception as e:
        print(f"❌ 임베딩 변환 실패!: {e}")
        return False

    # 6️⃣ [에러 방어] 5개씩 쪼개서 넣고, 타임아웃 나면 재시도(Retry)
    CHUNK_SIZE = 5  
    total_new_data = len(needs_embedding)
    
    for i in range(0, total_new_data, CHUNK_SIZE):
        chunk = needs_embedding[i : i + CHUNK_SIZE]
        db_success = False
        
        # 🔥 한 조각당 3번씩 끈질기게 시도
        for db_attempt in range(3):
            try:
                supabase.table("policies").upsert(chunk, on_conflict="id").execute()
                db_success = True
                break
            except Exception as e:
                print(f"    ⚠️ DB 조각 저장 지연 (시도 {db_attempt+1}/3) - 3초 후 재시도...")
                time.sleep(3)
                
        if db_success:
            print(f"    ㄴ 변경 조각 저장 완료: {min(i + CHUNK_SIZE, total_new_data)} / {total_new_data}")
        else:
            print(f"    ❌ DB 조각 저장 최종 실패. 이 5개 데이터는 포기하고 넘어갑니다.")
            
        time.sleep(2) # DB 숨 고르기
        
    return True # 일부 조각이 실패했어도 전체 스크립트를 터뜨리지 않고 다음 페이지로 넘김!

# ==============================================================================
# 🟢 1. 보조금24 데이터 수집 함수
# ==============================================================================
def fetch_bojogeum24_data() -> int:
    print("\n🚀 [STAGE 1] 보조금24 데이터 수집을 시작합니다...")
    headers = { "accept": "application/json", "Authorization": f"Infuser {PUBLIC_DATA_KEY}" }
    page = 1
    per_page = 100
    saved_count = 0
    consecutive_fails = 0 # 🌟 [긴급 제동 장치] 연속 실패 카운터

    while True:
        print(f"🔄 보조금24 - {page}페이지 수집 요청 중...")
        params = { "page": page, "perPage": per_page, "serviceKey": PUBLIC_DATA_KEY, "returnType": "JSON" }
        
        max_retries = 3
        fetch_success = False
        data = None

        for attempt in range(max_retries):
            try:
                response = requests.get(BOJOGEUM_URL, headers=headers, params=params, timeout=45)
                if response.status_code == 400:
                    break
                response.raise_for_status()
                data = response.json()
                fetch_success = True
                break
            except Exception as e:
                print(f"⚠️ API 오류 (시도: {attempt + 1}/{max_retries}): {e}")
                if attempt < max_retries - 1: time.sleep(5)

        # 🌟 무한 루프 방지 로직 적용
        if not fetch_success or not data:
            consecutive_fails += 1
            if consecutive_fails >= 3:
                print("🚨 [긴급 제동] 보조금24 3페이지 연속 수집 실패! 서버 장애로 판단하여 수집을 강제 종료합니다.")
                break # 무한 루프 강제 탈출
            print(f"❌ {page}페이지 수집 실패. 건너뜁니다.")
            page += 1
            continue
        else:
            consecutive_fails = 0 # 성공하면 카운터 초기화!

        policies = data.get("data", [])
        if not policies:
            print("🏁 보조금24 데이터를 모두 긁어왔습니다!")
            break
            
        is_success = sync_to_supabase(policies)
        
        # 🌟 [에러 방어] 저장이 실패해도 절대 break(종료) 하지 않음!
        if is_success: 
            saved_count += len(policies)
        else: 
            print(f"⚠️ {page}페이지 DB 저장 중 일부 문제가 발생했지만 수집을 계속합니다.")

        time.sleep(1.2)
        page += 1

    return saved_count

# ==============================================================================
# 🔵 2. 복지로 데이터 수집 함수
# ==============================================================================
def fetch_bokjiro_data() -> int:
    print("\n🚀 [STAGE 2] 복지로 데이터 수집을 시작합니다...")
    page = 1
    per_page = 100
    saved_count = 0
    consecutive_fails = 0 # 🌟 [긴급 제동 장치] 연속 실패 카운터
    
    # 🌟 [이중 인코딩 방지] 복지로의 500 에러를 막기 위해 API 키를 미리 해독합니다.
    decoded_key = urllib.parse.unquote(PUBLIC_DATA_KEY) if PUBLIC_DATA_KEY else ""

    while True:
        print(f"🔄 복지로 - {page}페이지 수집 요청 중...")
        params = {
            "serviceKey": decoded_key, "pageNo": page, "numOfRows": per_page, # 🌟 PUBLIC_DATA_KEY 대신 해독된 키 사용!
            "callTp": "L", "returnType": "json" 
        }
        
        max_retries = 3
        fetch_success = False
        data = None

        for attempt in range(max_retries):
            try:
                response = requests.get(BOKJIRO_URL, params=params, timeout=45)
                if response.status_code == 400:
                    break
                response.raise_for_status()
                data = response.json()
                fetch_success = True
                break
            except Exception as e:
                print(f"⚠️ API 오류 (시도: {attempt + 1}/{max_retries}): {e}")
                if attempt < max_retries - 1: time.sleep(5)

        # 🌟 무한 루프 방지 로직 적용
        if not fetch_success or not data:
            consecutive_fails += 1
            if consecutive_fails >= 3:
                print("🚨 [긴급 제동] 복지로 3페이지 연속 500 에러 발생! 서버 장애로 판단하여 수집을 강제 종료합니다.")
                break # 97페이지까지 무한정 넘어가는 걸 여기서 막아줍니다!
            print(f"❌ {page}페이지 수집 실패. 건너뜁니다.")
            page += 1
            continue
        else:
            consecutive_fails = 0 # 성공하면 카운터 초기화!

        raw_policies = data.get("servList", [])
        if not raw_policies:
            print("🏁 복지로 데이터를 모두 긁어왔습니다!")
            break

        mapped_policies = []
        for p in raw_policies:
            mapped_policies.append({
                "서비스ID": p.get("servId", ""), "서비스명": p.get("servNm", ""),
                "소관기관명": p.get("jurMnofNm", "복지로"), "지원대상": p.get("trgterIndvdlArray", ""), 
                "서비스분야": p.get("intrsThemaArray", ""), "상세조회URL": p.get("servDtlLink", "")
            })
            
        is_success = sync_to_supabase(mapped_policies)
        
        # 🌟 [에러 방어] 복지로도 저장이 실패해도 절대 break(종료) 하지 않음!
        if is_success: 
            saved_count += len(mapped_policies)
        else: 
            print(f"⚠️ {page}페이지 DB 저장 중 일부 문제가 발생했지만 수집을 계속합니다.")

        time.sleep(1.2)
        page += 1

    return saved_count

# ==============================================================================
# 🌟 메인 오케스트레이터
# ==============================================================================
def fetch_all_data():
    print("🚀 [전체 파이프라인 가동] 보조금24 + 복지로 DB 동기화 시작...")
    
    if not PUBLIC_DATA_KEY:
        print("❌ 에러: 환경변수에서 API 키를 찾을 수 없습니다.")
        return

    bojogeum_total = fetch_bojogeum24_data()
    bokjiro_total = fetch_bokjiro_data()
    
    total_saved = bojogeum_total + bokjiro_total
    print(f"\n🎉 [최종 결산] 보조금24({bojogeum_total}개) + 복지로({bokjiro_total}개) = 총 {total_saved}개 동기화 완료!")
    
    cleanup_zombie_policies(total_saved)

if __name__ == "__main__":
    fetch_all_data()
