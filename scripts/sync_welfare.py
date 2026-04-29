import os
import time
import requests
import hashlib
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone  # 🌟 timezone 추가 완료
from supabase import create_client, Client
from dotenv import load_dotenv
from langchain_openai import OpenAIEmbeddings

# 1. 환경 변수 로드
load_dotenv()

# 2. 인증키 및 DB 설정 가져오기
PUBLIC_DATA_KEY = os.getenv("PUBLIC_DATA_PORTAL_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

# 🌟 보조금24 & 복지로 API 엔드포인트 세팅
BOJOGEUM_URL = "https://api.odcloud.kr/api/gov24/v3/serviceList"
BOKJIRO_URL = "http://apis.data.go.kr/B554287/NationalWelfareInformationsV001/NationalWelfarelistV001"

# 3. Supabase 클라이언트 초기화
supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# 임베딩 객체 전역 생성 (최적화)
embeddings = None
try:
    embeddings = OpenAIEmbeddings(model="text-embedding-3-small")
except Exception as e:
    print(f"❌ OpenAI 초기화 에러: {e}")

def utc_now_iso() -> str:
    """timezone-aware UTC ISO 문자열"""
    return datetime.now(timezone.utc).isoformat()

# ==============================================================================
# 🌟 [소프트 삭제 적용] 좀비 정책 청소 로직
# ==============================================================================
def deactivate_stale_policies(total_saved):
    """3일 이상 갱신 안 된 정책을 안전하게 비활성화 (soft delete)"""
    if total_saved < 100:
        print("⚠️ [안전장치 작동] 오늘 수집된 데이터가 너무 적어 청소를 생략합니다.")
        return

    print("🧹 [청소 닌자 출동] 마감된 좀비 정책 데이터 안전 숨김(Soft Delete) 처리를 시작합니다...")
    if not supabase: return
        
    try:
        three_days_ago = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
        
        # 🌟 Hard Delete 방지 + 불필요한 중복 업데이트 방지 + 청년 정책(R%) 침범 방지 로직 완벽 적용!
        response = (
            supabase.table("policies")
            .update({
                "is_active": False, 
                "updated_at": utc_now_iso()
            })
            .lt("updated_at", three_days_ago)
            .eq("is_active", True)  # 이미 비활성인 것 중복 처리 방지
            .not_.like("id", "R%")  # 🌟 청년 정책 데이터는 건드리지 않음 (선 긋기)
            .execute()
        )
        deactivated_count = len(response.data) if response.data else 0
        print(f"✨ [청소 완료] {deactivated_count}개 정책을 안전하게 숨김 처리(soft delete)")
        print(f"   → 복구 필요 시: UPDATE policies SET is_active = TRUE WHERE id IN (...)")
    except Exception as e:
        print(f"❌ 청소 중 오류 발생: {e}")

# ==============================================================================
# 🌟 [핵심] 지문 필터링(비용 절감) + DB 불사조 로직
# ==============================================================================
def sync_to_supabase(policies):
    if not supabase:
        print("❌ 에러: Supabase 환경변수 누락")
        return False

    formatted_data = []
    api_ids = []
    now_iso = utc_now_iso()

    for p in policies:
        pid = p.get("서비스ID") or p.get("id", "")
        pid = pid.strip()
        if not pid:
            continue

        title = p.get("서비스명") or p.get("title", "이름 없음")
        provider = p.get("소관기관명") or p.get("provider", "기관 없음")
        summary = p.get("지원대상") or p.get("summary", "")
        category = p.get("서비스분야") or p.get("category", "")
        url = p.get("상세조회URL") or p.get("url", "")

        # 요약 내용은 임베딩 비용 절약 및 제한을 위해 자르기 (옵션)
        safe_summary = summary[:1000] if summary else ""

        content_str = f"{title}{provider}{category}{safe_summary}"
        content_hash = hashlib.sha1(content_str.encode('utf-8')).hexdigest()

        formatted_data.append({
            "id": pid, 
            "title": title, 
            "provider": provider,
            "summary": safe_summary, 
            "category": category, 
            "url": url,
            "content_hash": content_hash, 
            "updated_at": now_iso,
            "is_active": True  # 🌟 소프트 삭제됐던 정책이 다시 나타나면 부활시키기 위해 True 강제 주입!
        })
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
            texts_to_embed = [f"정책명: {d['title']} 주관: {d['provider']} 카테고리: {d['category']} 내용: {d['summary']}" for d in needs_embedding]
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
                wait_time = 2 ** db_attempt
                print(f"    ⚠️ DB 조각 저장 지연 (시도 {db_attempt+1}/3) - {wait_time}초 후 재시도...")
                time.sleep(wait_time)
                
        if db_success:
            print(f"    ㄴ 변경 조각 저장 완료: {min(i + CHUNK_SIZE, total_new_data)} / {total_new_data}")
        else:
            print(f"    ❌ DB 조각 저장 최종 실패.")
            
        time.sleep(1) 
        
    return True 

# ==============================================================================
# 🟢 1. 보조금24 데이터 수집 함수
# ==============================================================================
def fetch_bojogeum24_data() -> int:
    print("\n🚀 [STAGE 1] 보조금24 데이터 수집을 시작합니다...")
    headers = { "accept": "application/json", "Authorization": f"Infuser {PUBLIC_DATA_KEY}" }
    page = 1
    saved_count = 0
    consecutive_fails = 0 

    while True:
        print(f"🔄 보조금24 - {page}페이지 수집 요청 중...")
        params = { "page": page, "perPage": 100, "serviceKey": PUBLIC_DATA_KEY, "returnType": "JSON" }
        
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
                wait_time = 2 ** attempt
                print(f"⚠️ API 오류 (시도: {attempt + 1}/{max_retries}): {e} -> {wait_time}초 대기")
                time.sleep(wait_time)

        if not fetch_success or not data:
            consecutive_fails += 1
            if consecutive_fails >= 3:
                print("🚨 [긴급 제동] 보조금24 3회 연속 실패 강제 종료.")
                break 
            page += 1
            continue
        else:
            consecutive_fails = 0 

        policies = data.get("data", [])
        if not policies:
            print("🏁 보조금24 데이터를 모두 긁어왔습니다!")
            break
            
        if sync_to_supabase(policies): 
            saved_count += len(policies)
        else: 
            print(f"⚠️ {page}페이지 저장 중 일부 에러 발생.")

        time.sleep(1.2)
        page += 1

    return saved_count

# ==============================================================================
# 🔵 2. 복지로 데이터 수집 함수
# ==============================================================================
def fetch_bokjiro_data() -> int:
    print("\n🚀 [STAGE 2] 복지로 데이터 수집을 시작합니다...")
    page = 1
    saved_count = 0
    consecutive_fails = 0 
    
    base_url = f"{BOKJIRO_URL}?serviceKey={PUBLIC_DATA_KEY}"

    while True:
        print(f"🔄 복지로 - {page}페이지 수집 요청 중...")
        
        params = {
            "callTp": "L",
            "srchKeyCode": "001",
            "pageNo": page,
            "numOfRows": 100
        }
        
        max_retries = 3
        fetch_success = False
        root = None

        for attempt in range(max_retries):
            try:
                response = requests.get(
                    base_url,
                    params=params,
                    headers={"User-Agent": "Mozilla/5.0"},
                    timeout=45
                )
                if response.status_code == 400:
                    break
                response.raise_for_status()
                
                xml_data = response.text
                if "OpenAPI_ServiceResponse" in xml_data:
                    print("🚨 API 에러 응답 발견 (XML)")
                    break
                    
                try:
                    root = ET.fromstring(xml_data)
                except Exception as e:
                    print("❌ XML 파싱 실패:", e)
                    fetch_success = False
                    break
                    
                fetch_success = True
                break
            except Exception as e:
                wait_time = 2 ** attempt
                print(f"⚠️ API 오류 (시도: {attempt + 1}/{max_retries}): {e} -> {wait_time}초 대기")
                time.sleep(wait_time)

        if not fetch_success or root is None:
            consecutive_fails += 1
            if consecutive_fails >= 3:
                print("🚨 [긴급 제동] 복지로 3페이지 연속 실패! 강제 종료합니다.")
                break 
            page += 1
            continue
        else:
            consecutive_fails = 0 

        err_msg = root.find(".//errMsg")
        if err_msg is not None:
            print(f"🚨 [정부 API 에러 발견!] 사유: {err_msg.text}")
            break
            
        result_code = root.find(".//resultCode")
        if result_code is not None and result_code.text not in ["0", "00"]:
            result_msg = root.find(".//resultMessage")
            msg = result_msg.text if result_msg is not None else ""
            print(f"🚨 [정부 API 응답 에러] 코드: {result_code.text}, 메시지: {msg}")
            break

        raw_policies = root.findall(".//servList")
        if not raw_policies:
            print("🏁 복지로 데이터를 모두 긁어왔습니다!")
            break

        mapped_policies = []
        for p in raw_policies:
            def get_text(tag_name):
                node = p.find(tag_name)
                return node.text if node is not None and node.text else ""

            mapped_policies.append({
                "서비스ID": get_text("servId"), 
                "서비스명": get_text("servNm"),
                "소관기관명": get_text("jurMnofNm") or "복지로", 
                "지원대상": get_text("trgterIndvdlArray"), 
                "서비스분야": get_text("intrsThemaArray"), 
                "상세조회URL": get_text("servDtlLink")
            })
            
        if sync_to_supabase(mapped_policies): 
            saved_count += len(mapped_policies)
        else: 
            print(f"⚠️ {page}페이지 DB 저장 중 에러 발생.")

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
    
    # 🌟 함수 이름 변경 완벽 적용!
    deactivate_stale_policies(total_saved)

if __name__ == "__main__":
    fetch_all_data()
