import os
import time
import urllib.request
import urllib.parse
import ssl
import xml.etree.ElementTree as ET
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

def sync_to_supabase(policies):
    """DB 저장 및 OpenAI 임베딩을 수행하는 튼튼한 함수"""
    if not supabase:
        print("❌ 에러: Supabase 설정 누락")
        return False

    # 🔥 [핵심 추가] DB에 넣기 전에 OpenAI로 텍스트를 임베딩(벡터) 변환!
    try:
        print(f"🤖 OpenAI API로 {len(policies)}개 청년정책 내용을 임베딩(벡터) 변환 중...")
        embeddings = OpenAIEmbeddings(model="text-embedding-3-small")
        
        texts_to_embed = [
            f"정책명: {data['title']} 주관: {data['provider']} 카테고리: {data['category']} 내용: {data['summary']}" 
            for data in policies
        ]
        
        vectors = embeddings.embed_documents(texts_to_embed)
        
        for i, data in enumerate(policies):
            data["embedding"] = vectors[i]
            
    except Exception as e:
        print(f"❌ 임베딩 변환 실패! (OpenAI API 키 확인 필요): {e}")
        return False

    # 🌟 [초강력 타임아웃 방지] 5개씩 아주 잘게 쪼개서 넣기!
    CHUNK_SIZE = 5  
    total_data = len(policies)
    
    try:
        for i in range(0, total_data, CHUNK_SIZE):
            chunk = policies[i : i + CHUNK_SIZE]
            
            supabase.table("policies").upsert(
                chunk, 
                on_conflict="id"
            ).execute()
            
            print(f"    ㄴ 조각 저장 완료: {min(i + CHUNK_SIZE, total_data)} / {total_data}")
            time.sleep(2) # 인덱스 갱신을 위한 2초 휴식
            
        return True
        
    except Exception as e:
        print(f"❌ DB 조각 저장 중 오류 발생: {e}")
        return False

def fetch_youth_data():
    print("🚀 [청년 파이프라인] 온라인청년센터 데이터 수집 시작 (무적의 좀비 모드)")
    
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

        # ==============================================================================
        # 🌟 [시니어의 비법 적용] API 통신 실패 시 좀비처럼 살아나는 Retry 로직 추가!
        # ==============================================================================
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
                break # 🌟 성공 시 재시도 루프 탈출!

            except Exception as e:
                print(f"⚠️ API 오류 (시도: {attempt + 1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    print("⏳ 5초 뒤에 다시 찔러봅니다...")
                    time.sleep(5)
                else:
                    print(f"❌ 3번 재시도 실패. {page}페이지 건너뜁니다.")

        # ==============================================================================

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

        if sync_to_supabase(policies):
            total_saved += len(policies)
        else:
            print("⚠️ DB 저장 중 치명적 오류 발생. 수집을 중단합니다.")
            break

        time.sleep(1.5)
        page += 1

    print(f"🎉 [청년 파이프라인] 총 {total_saved}개 동기화 완료!\n")

if __name__ == "__main__":
    fetch_youth_data()
