import os
import time
import urllib.request
import urllib.parse
import ssl
import xml.etree.ElementTree as ET
import hashlib # 🌟 [핵심 추가] 데이터 지문 생성을 위한 라이브러리
from supabase import create_client, Client
from dotenv import load_dotenv
from langchain_openai import OpenAIEmbeddings

# 1. 환경 변수 로드
load_dotenv()

# 2. 인증키 및 DB 설정 가져오기
YOUTH_API_KEY = os.getenv("YOUTH_POLICY_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

YOUTH_CENTER_URL = "https://www.youthcenter.go.kr/opi/empList.do"

# 3. Supabase 클라이언트 초기화
supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ==============================================================================
# 🌟 [수술 완료] 지문 필터링(비용 절감) + DB 불사조 로직 융합!
# ==============================================================================
def sync_to_supabase(policies):
    """[스마트 버전] 변경된 데이터만 골라서 OpenAI 임베딩 후 DB에 저장하는 함수"""
    if not supabase:
        print("❌ 에러: Supabase 설정 누락")
        return False

    formatted_data = []
    api_ids = []

    # 1️⃣ 데이터에 '디지털 지문(Hash)' 생성 추가
    for p in policies:
        pid = p.get("id", "")
        title = p.get("title", "이름 없음")
        provider = p.get("provider", "주관기관 없음")
        summary = p.get("summary", "")
        category = p.get("category", "청년정책")

        # 텍스트를 뭉쳐서 하나의 '지문' 생성
        content_str = f"{title}{provider}{category}{summary}"
        content_hash = hashlib.md5(content_str.encode('utf-8')).hexdigest()

        # 기존 딕셔너리에 지문(content_hash) 추가
        p["content_hash"] = content_hash
        formatted_data.append(p)
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
        return True # 스킵 성공

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
        
    return True

# ==============================================================================
# 🟢 메인 수집 함수
# ==============================================================================
def fetch_youth_data():
    print("🚀 [청년 파이프라인] 온라인청년센터 데이터 수집 시작 (무적의 스마트 모드)")
    
    if not YOUTH_API_KEY:
        print("❌ YOUTH_POLICY_API_KEY가 없습니다.")
        return

    page = 1
    display = 100  
    total_saved = 0

    # SSL 우회 설정 (공공기관 방화벽 회피용)
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE

    while True:
        print(f"\n🔄 청년정책 {page}페이지 수집 중...")
        
        params = {"openApiVcyKey": YOUTH_API_KEY, "display": display, "pageIndex": page}
        query_string = urllib.parse.urlencode(params)
        full_url = f"{YOUTH_CENTER_URL}?{query_string}"

        req = urllib.request.Request(
            full_url, 
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36"}
        )

        max_retries = 3
        fetch_success = False
        root = None
        fatal_error = False

        for attempt in range(max_retries):
            try:
                # 타임아웃 45초 연장
                response = urllib.request.urlopen(req, context=ssl_context, timeout=45)
                
                if response.getcode() != 200:
                    print(f"⚠️ 비정상 응답 코드: {response.getcode()}")
                    if response.getcode() == 403:
                        print("❌ 403 Forbidden: 해외 IP(또는 서버) 차단이 확실합니다!")
                        fatal_error = True
                        break
                    raise Exception(f"HTTP {response.getcode()}")
                    
                xml_data = response.read().decode('utf-8')
                root = ET.fromstring(xml_data)
                
                if root.find("error") is not None:
                    print("⚠️ XML 내부에 에러 메시지가 포함되어 있습니다. (API 키 만료/오류 등)")
                    fatal_error = True
                    break

                fetch_success = True
                break # 성공 시 재시도 루프 탈출!

            except Exception as e:
                print(f"⚠️ API 오류 (시도: {attempt + 1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    print("⏳ 5초 뒤에 다시 찔러봅니다...")
                    time.sleep(5)
                else:
                    print(f"❌ 3번 재시도 실패. {page}페이지 건너뜁니다.")

        if fatal_error:
            break

        if not fetch_success or root is None:
            page += 1
            continue

        emp_list = root.findall("emp")
        if not emp_list:
            print("🏁 청년정책 데이터를 모두 긁어왔습니다!")
            break
            
        policies = []
        for emp in emp_list:
            def get_text(tag):
                node = emp.find(tag)
                return node.text if node is not None and node.text else ""

            biz_id = get_text("bizId")
            if biz_id:
                policies.append({
                    "id": biz_id,                        
                    "title": get_text("polyBizSjnm") or "이름 없음",      
                    "provider": get_text("cnsgNmor") or get_text("mngtMrof") or "주관기관 없음", 
                    "category": get_text("plcyTpNm") or "청년정책",          
                    "target_audience": (get_text("empmSttsCn") + " / " + get_text("accrRqisCn")).strip(" /"), 
                    "age_req": get_text("ageInfo"),                
                    "income_req": "",                               
                    "region_req": get_text("prcpCn"),               
                    "summary": get_text("polyItcnCn") + "\n[지원내용]\n" + get_text("sporCn"), 
                    "url": get_text("rqutUrla"),                    
                    "deadline": get_text("rqutPrdCn"),              
                    "is_active": True,                              
                    "updated_at": "now()"                           
                })

        # 🌟 [수술 포인트] 저장이 실패해도 스크립트가 뻗지 않도록 break를 없앴어!
        is_success = sync_to_supabase(policies)
        if is_success:
            total_saved += len(policies)
        else:
            print(f"⚠️ {page}페이지 DB 저장 중 일부 문제가 발생했지만 수집을 계속합니다.")

        time.sleep(1.5)
        page += 1

    print(f"🎉 [청년 파이프라인] 총 {total_saved}개 동기화 완료!\n")

if __name__ == "__main__":
    fetch_youth_data()
