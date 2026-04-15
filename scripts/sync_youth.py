import os
import time
import urllib.request
import urllib.parse
import ssl
import xml.etree.ElementTree as ET
from supabase import create_client, Client
from dotenv import load_dotenv

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
    if not supabase:
        print("❌ 에러: Supabase 설정 누락")
        return False

    formatted_data = []
    for p in policies:
        formatted_data.append({
            "id": p.get("bizId", ""),                       
            "title": p.get("polyBizSjnm", "이름 없음"),      
            "provider": p.get("cnsgNmor", "주관기관 없음"),  # agency -> provider
            "category": p.get("plcyTpNm", "청년정책"),          
            "target_audience": (p.get("empmSttsCn", "") + " / " + p.get("accrRqisCn", "")).strip(" /"), 
            "age_req": p.get("ageInfo", ""),                
            "income_req": "",                               
            "region_req": p.get("prcpCn", ""),              
            "summary": p.get("polyItcnCn", "") + "\n[지원내용]\n" + p.get("sporCn", ""), # description -> summary
            "url": p.get("rqutUrla", ""),                   
            "deadline": p.get("rqutPrdCn", ""),             
            "is_active": True,                              
            "updated_at": "now()"                           
        })

    try:
        supabase.table("policies").upsert(formatted_data, on_conflict="id").execute()
        return True
    except Exception as e:
        print(f"❌ DB 저장 오류: {e}")
        return False

def fetch_youth_data():
    print("🚀 [청년 파이프라인] 온라인청년센터 데이터 수집 시작 (방화벽 우회 모드)")
    
    if not YOUTH_API_KEY:
        print("❌ YOUTH_POLICY_API_KEY가 없습니다.")
        return

    page = 1
    display = 100  
    total_saved = 0

    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE

    while True:
        print(f"🔄 청년정책 {page}페이지 수집 중...")
        
        params = {"openApiVcyKey": YOUTH_API_KEY, "display": display, "pageIndex": page}
        query_string = urllib.parse.urlencode(params)
        full_url = f"{YOUTH_CENTER_URL}?{query_string}"

        req = urllib.request.Request(
            full_url, 
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36"}
        )

        try:
            response = urllib.request.urlopen(req, context=ssl_context, timeout=30)
            if response.getcode() != 200: break
                
            root = ET.fromstring(response.read().decode('utf-8'))
            if root.find("error") is not None: break

            emp_list = root.findall("emp")
            if not emp_list: break
            
            policies = []
            for emp in emp_list:
                def get_text(tag):
                    node = emp.find(tag)
                    return node.text if node is not None and node.text else ""

                if get_text("bizId"):
                    policies.append({
                        "bizId": get_text("bizId"), "polyBizSjnm": get_text("polyBizSjnm"),
                        "cnsgNmor": get_text("cnsgNmor") or get_text("mngtMrof"),
                        "plcyTpNm": get_text("plcyTpNm"), "empmSttsCn": get_text("empmSttsCn"),
                        "accrRqisCn": get_text("accrRqisCn"), "ageInfo": get_text("ageInfo"),
                        "prcpCn": get_text("prcpCn"), "polyItcnCn": get_text("polyItcnCn"),
                        "sporCn": get_text("sporCn"), "rqutUrla": get_text("rqutUrla"),
                        "rqutPrdCn": get_text("rqutPrdCn")
                    })

            if sync_to_supabase(policies):
                total_saved += len(policies)
            else:
                break

            time.sleep(1.5)
            page += 1

        except Exception as e:
            print(f"❌ 오류 발생: {e}")
            break

    print(f"🎉 [청년 파이프라인] 총 {total_saved}개 동기화 완료!\n")

if __name__ == "__main__":
    fetch_youth_data()
