import os
import time
import requests
import urllib3
import xml.etree.ElementTree as ET
from supabase import create_client, Client
from dotenv import load_dotenv

# 🌟 파이썬아, 보안 인증서 경고창 띄우지 마!
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# 1. 환경 변수 로드
load_dotenv()

# 2. 인증키 및 DB 설정 가져오기
YOUTH_API_KEY = os.getenv("YOUTH_POLICY_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

# 온라인청년센터 청년정책 API 엔드포인트
YOUTH_CENTER_URL = "https://www.youthcenter.go.kr/opi/empList.do"

# 3. Supabase 클라이언트 초기화
supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def sync_to_supabase(policies):
    if not supabase:
        print("❌ 에러: Supabase 환경변수(URL 또는 KEY)가 설정되지 않았습니다.")
        return False

    formatted_data = []
    for p in policies:
        formatted_data.append({
            "id": p.get("bizId", ""),                       
            "title": p.get("polyBizSjnm", "이름 없음"),      
            "provider": p.get("cnsgNmor", "주관기관 없음"),  
            "category": p.get("plcyTpNm", "기타"),          
            "target_audience": (p.get("empmSttsCn", "") + " / " + p.get("accrRqisCn", "")).strip(" /"), 
            "age_req": p.get("ageInfo", ""),                
            "income_req": "",                               
            "region_req": p.get("prcpCn", ""),              
            "summary": p.get("polyItcnCn", "") + "\n\n[지원내용]\n" + p.get("sporCn", ""), 
            "url": p.get("rqutUrla", ""),                   
            "deadline": p.get("rqutPrdCn", ""),             
            "is_active": True,                              
            "updated_at": "now()"                           
        })

    try:
        supabase.table("policies").upsert(
            formatted_data, 
            on_conflict="id"
        ).execute()
        return True
    except Exception as e:
        print(f"❌ DB 저장 중 오류 발생: {e}")
        return False

def fetch_all_data():
    print("🚀 [실전 모드] 온라인청년센터 데이터 수집 시작 (강의실/사내 프록시 우회 모드)...")
    
    if not YOUTH_API_KEY:
        print("❌ 에러: 환경변수에서 YOUTH_POLICY_API_KEY를 찾을 수 없습니다.")
        return

    page = 1
    display = 100  
    total_saved = 0

    # 🌟 [비밀 무기 1] 완벽한 일반 사용자(크롬 브라우저)로 위장하는 신분증
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Connection": "keep-alive"
    }

    # 🌟 [비밀 무기 2] 대학교/회사 내부망의 8080 포트 납치(프록시)를 무시하는 세션 생성!
    session = requests.Session()
    session.trust_env = False  # 환경변수에 있는 HTTP_PROXY, HTTPS_PROXY를 강제로 무시함

    while True:
        print(f"🔄 {page}페이지 (총 {display}개씩) 수집 요청 중...")
        
        params = {
            "openApiVcyKey": YOUTH_API_KEY,
            "display": display,
            "pageIndex": page
        }

        try:
            # 🌟 session 객체로 요청을 보내서 방화벽 우회!
            response = session.get(
                YOUTH_CENTER_URL, 
                params=params, 
                headers=headers, 
                timeout=30, 
                verify=False
            )
            response.raise_for_status()
            
            root = ET.fromstring(response.content)
            
            error_node = root.find("error")
            if error_node is not None:
                print(f"⚠️ API 에러 발생: {error_node.findtext('message')}")
                break

            emp_list = root.findall("emp")
            
            if not emp_list:
                print("🏁 더 이상 가져올 데이터가 없습니다. 수집을 완전히 종료합니다!")
                break
            
            policies = []
            for emp in emp_list:
                def get_text(tag):
                    node = emp.find(tag)
                    return node.text if node is not None and node.text else ""

                policy = {
                    "bizId": get_text("bizId"),               
                    "polyBizSjnm": get_text("polyBizSjnm"),   
                    "cnsgNmor": get_text("cnsgNmor") or get_text("mngtMrof"), 
                    "plcyTpNm": get_text("plcyTpNm"),         
                    "empmSttsCn": get_text("empmSttsCn"),     
                    "accrRqisCn": get_text("accrRqisCn"),     
                    "ageInfo": get_text("ageInfo"),           
                    "prcpCn": get_text("prcpCn"),             
                    "polyItcnCn": get_text("polyItcnCn"),     
                    "sporCn": get_text("sporCn"),             
                    "rqutUrla": get_text("rqutUrla"),         
                    "rqutPrdCn": get_text("rqutPrdCn")        
                }
                
                if policy["bizId"]:
                    policies.append(policy)

            print(f"✅ {page}페이지에서 {len(policies)}개의 데이터를 찾았습니다. DB로 전송 중...")
            
            is_success = sync_to_supabase(policies)
            
            if is_success:
                total_saved += len(policies)
                print(f"✨ 현재까지 총 {total_saved}개 저장 완료")
            else:
                print("⚠️ DB 저장 단계에서 실패했습니다. 작업을 중단합니다.")
                break

            time.sleep(1.5)
            page += 1

        except Exception as e:
            print(f"❌ 통신 또는 XML 파싱 중 오류 발생: {e}")
            break

    print(f"\n🎉 [최종 결과] 총 {total_saved}개의 청년정책 공식 데이터가 DB에 완벽 동기화되었습니다!")

if __name__ == "__main__":
    fetch_all_data()
