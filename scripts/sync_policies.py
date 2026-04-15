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
    print("🚀 [실전 모드] 청년정책 데이터 수집 시작 (강력한 urllib + SSL 무회 모드)...")
    
    if not YOUTH_API_KEY:
        print("❌ 에러: 환경변수에서 YOUTH_POLICY_API_KEY를 찾을 수 없습니다.")
        return

    page = 1
    display = 100  
    total_saved = 0

    # 🌟 [비밀 무기 1] 강력한 SSL 검사 무시 컨텍스트 생성 (정부 사이트 필수)
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE

    while True:
        print(f"🔄 {page}페이지 (총 {display}개씩) 수집 요청 중...")
        
        # URL 파라미터 조립
        params = {
            "openApiVcyKey": YOUTH_API_KEY,
            "display": display,
            "pageIndex": page
        }
        query_string = urllib.parse.urlencode(params)
        full_url = f"{YOUTH_CENTER_URL}?{query_string}"

        # 🌟 [비밀 무기 2] requests를 버리고 순정 urllib 사용 + 크롬 위장
        req = urllib.request.Request(
            full_url, 
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            }
        )

        try:
            # 타임아웃 30초, SSL 검사 무시 옵션 장착
            response = urllib.request.urlopen(req, context=ssl_context, timeout=30)
            
            if response.getcode() != 200:
                print(f"❌ 통신 실패 (상태 코드: {response.getcode()})")
                break
                
            xml_data = response.read().decode('utf-8')
            root = ET.fromstring(xml_data)
            
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

        except urllib.error.URLError as e:
            print(f"❌ 통신 오류 발생 (URL 또는 방화벽 문제): {e}")
            break
        except Exception as e:
            print(f"❌ 알 수 없는 오류: {e}")
            break

    print(f"\n🎉 [최종 결과] 총 {total_saved}개의 청년정책 공식 데이터가 DB에 완벽 동기화되었습니다!")

if __name__ == "__main__":
    fetch_all_data()
