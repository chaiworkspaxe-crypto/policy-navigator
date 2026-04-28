import os
import time
import requests
import hashlib
from datetime import datetime, timedelta
from supabase import create_client, Client
from dotenv import load_dotenv
from langchain_openai import OpenAIEmbeddings

# 맨 처음 환경변수부터 로드
load_dotenv()

print("🚀 청년정책 스크립트 시작됨")
print("KEY 유무 확인:", "존재함" if os.getenv("YOUTH_POLICY_API_KEY") else "없음")
print("파일 실행 정상")

# 2. 인증키 및 DB 설정 가져오기
YOUTH_API_KEY = os.getenv("YOUTH_POLICY_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

# 🌟 새로운 JSON API 엔드포인트
YOUTH_CENTER_URL = "https://www.youthcenter.go.kr/opi/empList.do"

# 3. Supabase 클라이언트 초기화
supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ==============================================================================
# 🌟 지문 필터링(비용 절감) + DB 불사조 로직
# ==============================================================================
def sync_to_supabase(policies):
    if not supabase:
        print("❌ 에러: Supabase 설정 누락")
        return False

    formatted_data = []
    api_ids = []
    now_iso = datetime.utcnow().isoformat()

    for p in policies:
        pid = p.get("id", "").strip()
        if not pid:
            continue

        title = p.get("title", "이름 없음")
        provider = p.get("provider", "주관기관 없음")
        summary = p.get("summary", "")
        category = p.get("category", "청년정책")

        content_str = f"{title}{provider}{category}{summary}"
        content_hash = hashlib.md5(content_str.encode('utf-8')).hexdigest()

        p["content_hash"] = content_hash
        p["updated_at"] = now_iso 
        
        formatted_data.append(p)
        api_ids.append(pid)

    db_hash_map = {}
    if api_ids:
        try:
            existing_records = supabase.table("policies").select("id, content_hash").in_("id", api_ids).execute()
            db_hash_map = {record["id"]: record.get("content_hash") for record in existing_records.data}
        except Exception as e:
            print(f"⚠️ DB 지문 조회 에러: {e}")

    needs_embedding = []
    for data in formatted_data:
        pid = data["id"]
        api_hash = data["content_hash"]
        if pid not in db_hash_map or db_hash_map[pid] != api_hash:
            needs_embedding.append(data)

    if not needs_embedding:
        print(f"    ⏩ {len(policies)}개 중 변경된 데이터 없음. (비용 0원 스킵!)")
        return True 

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

    CHUNK_SIZE = 50  
    total_new_data = len(needs_embedding)
    
    for i in range(0, total_new_data, CHUNK_SIZE):
        chunk = needs_embedding[i : i + CHUNK_SIZE]
        db_success = False
        
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
            print(f"    ❌ DB 조각 저장 최종 실패.")
            
        time.sleep(2) 
        
    return True

# ==============================================================================
# 🟢 메인 수집 함수
# ==============================================================================
def fetch_youth_data():
    print("🚀 [청년 파이프라인] 온라인청년센터 데이터 수집 시작 (JSON 스마트 모드)")
    
    if not YOUTH_API_KEY:
        print("❌ YOUTH_POLICY_API_KEY가 없습니다.")
        return

    page = 1
    display = 100  
    total_saved = 0
    consecutive_fails = 0 

    # 🌟 피드백 반영: 헤더 추가 (403 Forbidden 및 접근 거부 방어)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }

    while True:
        print(f"\n🔄 청년정책 {page}페이지 수집 중...")
        
        # 🌟 피드백 반영: returnType json 명시
        params = {
            "openApiVcyKey": YOUTH_API_KEY, 
            "display": display, 
            "pageIndex": page,
            "returnType": "json"
        }

        max_retries = 3
        fetch_success = False
        data = None

        for attempt in range(max_retries):
            try:
                # 헤더 장착 완료
                response = requests.get(YOUTH_CENTER_URL, params=params, headers=headers, timeout=45)
                
                if response.status_code == 200:
                    # 🌟 피드백 반영: 무엇을 뱉어내는지 RAW 데이터부터 무조건 확인!
                    print("🔍 RAW RESPONSE (최초 500자):", response.text[:500])
                    
                    try:
                        data = response.json() 
                        
                        if not isinstance(data, dict):
                            print(f"⚠️ JSON 형식이 아님 (HTML 반환 의심됨): {response.text[:100]}")
                            continue
                            
                        # 🌟 피드백 반영: 데이터 구조 엄격 검증
                        if "result" not in data and "youthPolicyList" not in data:
                            print(f"⚠️ 예상과 다른 응답 구조 (API 파라미터 확인 필요): {str(data)[:200]}")
                            continue

                        fetch_success = True
                        break
                    except Exception as e:
                        print(f"⚠️ JSON 파싱 에러 (XML이나 HTML을 줬을 확률 높음): {e}")
                elif response.status_code == 403:
                    print("❌ 403 Forbidden: 서버 접근 차단!")
                    break
                else:
                    print(f"⚠️ 비정상 응답 코드: {response.status_code}")
                    
            except Exception as e:
                print(f"⚠️ API 통신 오류 (시도 {attempt + 1}): {e}")
                time.sleep(5)

        if not fetch_success or not data:
            print(f"❌ {page}페이지 수집 실패.")
            consecutive_fails += 1
            if consecutive_fails >= 3:
                print("🚨 3회 연속 실패. 서버 장애 혹은 구조 변경 판단 후 수집 종료")
                break
            page += 1
            continue
        else:
            consecutive_fails = 0
            
            # API마다 키 구조가 다를 수 있으므로 유연하게 대처
            if "result" in data:
                youth_list = data["result"].get("youthPolicyList", [])
            else:
                youth_list = data.get("youthPolicyList", [])
            
            if not youth_list:
                print("🏁 청년정책 데이터가 비어있습니다. (수집 완료 또는 API 파라미터 문제)")
                break
                
            policies = []
            for p in youth_list:
                provider_code = p.get("pvsnInstGroupCd", "")
                provider_name = "중앙부처" if provider_code == "0054001" else ("지자체" if provider_code == "0054002" else "청년정책")
                
                category_name = f"{p.get('lclsfNm', '')} > {p.get('mclsfNm', '')}".strip(" > ")

                policies.append({
                    "id": p.get("plcyNo", ""),                        
                    "title": p.get("plcyNm", "이름 없음"),      
                    "provider": provider_name, 
                    "category": category_name or "청년정책",          
                    "target_audience": p.get("ptcpPrpTrgtCn", ""), 
                    "age_req": p.get("ageInfo", ""),                
                    "income_req": "",                               
                    "region_req": "",                
                    "summary": f"{p.get('plcyExplnCn', '')}\n\n[지원내용]\n{p.get('plcySprtCn', '')}".strip(), 
                    "url": p.get("rqutUrla", ""),                    
                    "deadline": p.get("aplyPrdSeCd", "상시/기간확인"),              
                    "is_active": True,                              
                    "updated_at": datetime.utcnow().isoformat() 
                })

            is_success = sync_to_supabase(policies)
            if is_success:
                total_saved += len(policies)
            else:
                print(f"⚠️ {page}페이지 DB 저장 중 일부 에러 발생.")

            time.sleep(1.5)
            page += 1

    print(f"🎉 [청년 파이프라인] 총 {total_saved}개 동기화 완료!\n")

if __name__ == "__main__":
    fetch_youth_data()
