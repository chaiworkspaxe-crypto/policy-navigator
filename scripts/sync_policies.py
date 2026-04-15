import os
import time
import requests
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
    """가져온 데이터를 Supabase DB(policies 테이블)에 저장하는 함수"""
    if not supabase:
        print("❌ 에러: Supabase 환경변수(URL 또는 KEY)가 설정되지 않았습니다.")
        return False

    formatted_data = []
    for p in policies:
        # 🌟 중요: DB 컬럼명과 청년센터 API 필드명을 1:1로 매핑
        # 청년센터 API 상세 명세서를 기준으로 데이터를 가공합니다.
        formatted_data.append({
            "id": p.get("bizId", ""),                       # 정책 고유 ID (PK)
            "title": p.get("polyBizSjnm", "이름 없음"),      # 정책명
            "provider": p.get("cnsgNmor", "주관기관 없음"),  # 주관기관 (없으면 빈값)
            "category": p.get("plcyTpNm", "기타"),          # 정책유형 (예: 취업지원, 주거지원)
            "target_audience": (p.get("empmSttsCn", "") + " / " + p.get("accrRqisCn", "")).strip(" /"), # 취업상태 및 학력요건
            "age_req": p.get("ageInfo", ""),                # 연령 요건
            "income_req": "",                               # 소득 요건 (보통 prcpCn에 통합되어 있음)
            "region_req": p.get("prcpCn", ""),              # 거주지 및 소득 등 참여요건
            "summary": p.get("polyItcnCn", "") + "\n\n[지원내용]\n" + p.get("sporCn", ""), # 정책소개 + 지원내용
            "url": p.get("rqutUrla", ""),                   # 온라인 신청 URL
            "deadline": p.get("rqutPrdCn", ""),             # 신청 기간
            "is_active": True,                              # 활성화 상태
            "updated_at": "now()"                           # 업데이트 시간
        })

    try:
        # Upsert: id가 같으면 덮어쓰고, 없으면 새로 생성 (중복 방지)
        supabase.table("policies").upsert(
            formatted_data, 
            on_conflict="id"
        ).execute()
        return True
    except Exception as e:
        print(f"❌ DB 저장 중 오류 발생: {e}")
        return False

def fetch_all_data():
    print("🚀 [실전 모드] 온라인청년센터 청년정책 데이터 수집 및 DB 동기화 시작...")
    
    if not YOUTH_API_KEY:
        print("❌ 에러: 환경변수에서 YOUTH_POLICY_API_KEY를 찾을 수 없습니다.")
        return

    page = 1
    display = 100  # 한 번에 100개씩 효율적으로 수집 (청년센터 최대 권장치)
    total_saved = 0

    while True:
        print(f"🔄 {page}페이지 (총 {display}개씩) 수집 요청 중...")
        
        # 청년센터 API 파라미터 규격
        params = {
            "openApiVcyKey": YOUTH_API_KEY,
            "display": display,
            "pageIndex": page
        }

        try:
            # 타임아웃 15초 설정으로 무한 대기 방지
            response = requests.get(YOUTH_CENTER_URL, params=params, timeout=15)
            response.raise_for_status()
            
            # XML 데이터 파싱
            root = ET.fromstring(response.content)
            
            # API 내부 에러 체크
            error_node = root.find("error")
            if error_node is not None:
                print(f"⚠️ API 에러 발생: {error_node.findtext('message')}")
                break

            # 'emp' 노드(각 정책 데이터 뭉치) 리스트 가져오기
            emp_list = root.findall("emp")
            
            if not emp_list:
                print("🏁 더 이상 가져올 데이터가 없습니다. 수집을 완전히 종료합니다!")
                break
            
            policies = []
            for emp in emp_list:
                # XML 노드에서 텍스트를 안전하게 추출하는 내부 헬퍼 함수
                def get_text(tag):
                    node = emp.find(tag)
                    return node.text if node is not None and node.text else ""

                policy = {
                    "bizId": get_text("bizId"),               # 정책 ID
                    "polyBizSjnm": get_text("polyBizSjnm"),   # 정책명
                    "cnsgNmor": get_text("cnsgNmor") or get_text("mngtMrof"), # 주관/운영기관
                    "plcyTpNm": get_text("plcyTpNm"),         # 정책유형
                    "empmSttsCn": get_text("empmSttsCn"),     # 참여요건 - 취업상태
                    "accrRqisCn": get_text("accrRqisCn"),     # 참여요건 - 학력
                    "ageInfo": get_text("ageInfo"),           # 참여요건 - 연령
                    "prcpCn": get_text("prcpCn"),             # 참여요건 - 거주지/소득
                    "polyItcnCn": get_text("polyItcnCn"),     # 정책소개
                    "sporCn": get_text("sporCn"),             # 지원내용
                    "rqutUrla": get_text("rqutUrla"),         # 신청 URL
                    "rqutPrdCn": get_text("rqutPrdCn")        # 신청 기간
                }
                
                # ID가 없는 비정상 데이터는 건너뜀
                if policy["bizId"]:
                    policies.append(policy)

            print(f"✅ {page}페이지에서 {len(policies)}개의 데이터를 찾았습니다. DB로 전송 중...")
            
            # Supabase에 저장 실행
            is_success = sync_to_supabase(policies)
            
            if is_success:
                total_saved += len(policies)
                print(f"✨ 현재까지 총 {total_saved}개 저장 완료")
            else:
                print("⚠️ DB 저장 단계에서 실패했습니다. 작업을 중단합니다.")
                break

            # 💡 서버 부하 방지 및 API 호출 제한(Rate Limit)을 피하기 위한 휴식 (필수!)
            time.sleep(1.5)
            page += 1

        except Exception as e:
            print(f"❌ 통신 또는 XML 파싱 중 오류 발생: {e}")
            break

    print(f"\n🎉 [최종 결과] 총 {total_saved}개의 청년정책 공식 데이터가 DB에 완벽 동기화되었습니다!")

if __name__ == "__main__":
    fetch_all_data()
