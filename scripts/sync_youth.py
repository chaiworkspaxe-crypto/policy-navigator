import os
import time
import requests
import hashlib
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from supabase import create_client, Client
from dotenv import load_dotenv
from langchain_openai import OpenAIEmbeddings

# 1. 맨 처음 환경변수부터 로드
load_dotenv()

print("🚀 청년정책 스크립트 시작됨")
print("KEY 유무 확인:", "존재함" if os.getenv("YOUTH_POLICY_API_KEY") else "없음")
print("파일 실행 정상")

# 2. 인증키 및 DB 설정 가져오기
YOUTH_API_KEY = os.getenv("YOUTH_POLICY_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

YOUTH_CENTER_URL = "https://www.youthcenter.go.kr/opi/empList.do"

# 3. Supabase 클라이언트 초기화
supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# 🌟 창현 피드백 1️⃣: 임베딩 객체를 전역(Global)으로 한 번만 생성하여 메모리/속도 최적화!
embeddings = None
try:
    embeddings = OpenAIEmbeddings(model="text-embedding-3-small")
except Exception as e:
    print(f"❌ OpenAI 초기화 에러: {e}")

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
    
    if embeddings:
        try:
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
                # 🌟 창현 피드백 2️⃣: 지수 백오프 적용 (1초 -> 2초 -> 4초 대기)
                wait_time = 2 ** db_attempt
                print(f"    ⚠️ DB 조각 저장 지연 (시도 {db_attempt+1}/3) - {wait_time}초 후 재시도...")
                time.sleep(wait_time)
                
        if db_success:
            print(f"    ㄴ 변경 조각 저장 완료: {min(i + CHUNK_SIZE, total_new_data)} / {total_new_data}")
        else:
            # 🌟 창현 피드백 3️⃣: DB 실패 시 데이터 유실 방지용 로그 출력
            failed_titles = [item.get("title", "") for item in chunk[:3]]
            print(f"    ❌ DB 조각 저장 최종 실패! 유실 데이터 일부: {failed_titles} ... 등 {len(chunk)}개")
            
        time.sleep(2) 
        
    return True

# ==============================================================================
# 🟢 메인 수집 함수
# ==============================================================================
def fetch_youth_data():
    print("🚀 [청년 파이프라인] 온라인청년센터 데이터 수집 시작 (JSON/XML 하이브리드 모드)")
    
    if not YOUTH_API_KEY:
        print("❌ YOUTH_POLICY_API_KEY가 없습니다.")
        return

    page = 1
    display = 100  
    total_saved = 0
    consecutive_fails = 0 
    empty_page_count = 0  

    # 🌟 창현 피드백 4️⃣: 봇 차단 방지용 User-Agent 장착
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }

    while True:
        print(f"\n🔄 청년정책 {page}페이지 수집 중...")
        
        params = {
            "openApiVcyKey": YOUTH_API_KEY, 
            "display": display, 
            "pageIndex": page,
            "returnType": "json"
        }

        max_retries = 3
        fetch_success = False
        youth_list = []

        for attempt in range(max_retries):
            try:
                response = requests.get(YOUTH_CENTER_URL, params=params, headers=headers, timeout=45)
                
                if response.status_code == 200:
                    if page == 1:
                        print("🔍 1페이지 RAW RESPONSE:", response.text[:500])
                    
                    try:
                        data = response.json()
                        if "result" in data:
                            youth_list = data["result"].get("youthPolicyList", [])
                        else:
                            youth_list = data.get("youthPolicyList", [])
                        fetch_success = True
                        break
                        
                    except Exception as json_err:
                        print("⚠️ JSON 파싱 실패 → XML 파싱 시도로 전환!")
                        try:
                            root = ET.fromstring(response.text)
                            youth_list = []
                            
                            items = root.findall(".//emp") if root.findall(".//emp") else root.findall(".//youthPolicyList")
                            
                            # 🌟 창현 피드백 6️⃣: XML 태그 탐색 결과 로그 추가
                            print(f"🔍 [XML Fallback] 탐색된 정책 수: {len(items)}")
                            
                            for item in items:
                                youth_list.append({
                                    "pvsnInstGroupCd": item.findtext("pvsnInstGroupCd", ""),
                                    "lclsfNm": item.findtext("lclsfNm", ""),
                                    "mclsfNm": item.findtext("mclsfNm", ""),
                                    "plcyNo": item.findtext("plcyNo", ""),
                                    "plcyNm": item.findtext("plcyNm", "이름 없음"),
                                    "ptcpPrpTrgtCn": item.findtext("ptcpPrpTrgtCn", ""),
                                    "ageInfo": item.findtext("ageInfo", ""),
                                    "plcyExplnCn": item.findtext("plcyExplnCn", ""),
                                    "plcySprtCn": item.findtext("plcySprtCn", ""),
                                    "rqutUrla": item.findtext("rqutUrla", ""),
                                    "aplyPrdSeCd": item.findtext("aplyPrdSeCd", "상시/기간확인")
                                })
                            
                            fetch_success = True
                            break
                        except Exception as xml_err:
                            print(f"❌ XML 파싱도 실패: {xml_err}")
                
                elif response.status_code == 403:
                    print("❌ 403 Forbidden: 서버 접근 차단!")
                    break
                else:
                    print(f"⚠️ 비정상 응답 코드: {response.status_code}")
                    
            except Exception as e:
                # 🌟 창현 피드백 2️⃣: 통신 장애 시 지수 백오프 적용
                wait_time = 2 ** attempt
                print(f"⚠️ API 통신 오류 (시도 {attempt + 1}): {e} -> {wait_time}초 대기")
                time.sleep(wait_time)

        if not fetch_success:
            print(f"❌ {page}페이지 통신 및 파싱 최종 실패.")
            consecutive_fails += 1
            if consecutive_fails >= 3:
                print("🚨 3회 연속 실패. 수집을 강제 종료합니다.")
                break
            page += 1
            continue
        else:
            consecutive_fails = 0
            
            if not youth_list:
                empty_page_count += 1
                print(f"⚠️ 빈 페이지 발견 ({empty_page_count}/3) → 다음 페이지 확인")
                if empty_page_count >= 3:
                    print("🏁 3회 연속 빈 페이지. 청년정책 수집을 최종 완료합니다!")
                    break
                page += 1
                continue
            else:
                empty_page_count = 0  
                
            policies = []
            for p in youth_list:
                provider_code = p.get("pvsnInstGroupCd", "")
                provider_name = "중앙부처" if provider_code == "0054001" else ("지자체" if provider_code == "0054002" else "청년정책")
                category_name = f"{p.get('lclsfNm', '')} > {p.get('mclsfNm', '')}".strip(" > ")

                # 🌟 창현 피드백 5️⃣: Summary(지원내용) 1000자 제한으로 임베딩 토큰 낭비 방지!
                raw_summary = f"{p.get('plcyExplnCn', '')}\n\n[지원내용]\n{p.get('plcySprtCn', '')}".strip()
                safe_summary = raw_summary[:1000]

                policies.append({
                    "id": p.get("plcyNo", ""),                        
                    "title": p.get("plcyNm", "이름 없음"),      
                    "provider": provider_name, 
                    "category": category_name or "청년정책",          
                    "target_audience": p.get("ptcpPrpTrgtCn", ""), 
                    "age_req": p.get("ageInfo", ""),                
                    "income_req": "",                               
                    "region_req": "",                
                    "summary": safe_summary, 
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
