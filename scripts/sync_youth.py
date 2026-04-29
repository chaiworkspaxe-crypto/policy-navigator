import os
import time
import requests
import hashlib
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from supabase import create_client, Client
from dotenv import load_dotenv
from langchain_openai import OpenAIEmbeddings

# 1. 환경변수 로드
load_dotenv()

print("🚀 청년정책 스크립트 시작됨")
print("KEY 유무 확인:", "존재함" if os.getenv("YOUTH_POLICY_API_KEY") else "없음")
print("파일 실행 정상")

# 2. 인증키 및 DB 설정
YOUTH_API_KEY = os.getenv("YOUTH_POLICY_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

# 🌟 [URL 변경] 옛 엔드포인트 폐기 → 신규 엔드포인트
# 기존: https://www.youthcenter.go.kr/opi/empList.do (deprecated, timeout)
# 신규: https://www.youthcenter.go.kr/go/ythip/getPlcy
YOUTH_CENTER_URL = "https://www.youthcenter.go.kr/go/ythip/getPlcy"

# 3. Supabase 클라이언트 초기화
supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# 임베딩 객체 전역 생성
embeddings = None
try:
    embeddings = OpenAIEmbeddings(model="text-embedding-3-small")
except Exception as e:
    print(f"❌ OpenAI 초기화 에러: {e}")


def utc_now_iso() -> str:
    """timezone-aware UTC ISO 문자열 (Python 3.12+ 호환)"""
    return datetime.now(timezone.utc).isoformat()


# ==============================================================================
# 🌟 지문 필터링(비용 절감) + DB 저장
# ==============================================================================
def sync_to_supabase(policies):
    """
    Returns:
        dict: {"success": bool, "saved": int, "failed": int, "skipped": int}
    """
    result = {"success": False, "saved": 0, "failed": 0, "skipped": 0}

    if not supabase:
        print("❌ 에러: Supabase 설정 누락")
        return result

    # 🟢 [수정 8] 임베딩 객체 없으면 저장 자체를 중단 (NULL 임베딩 행 방지)
    if not embeddings:
        print("❌ 에러: 임베딩 객체 미초기화 → 저장 중단 (RAG 무결성 보호)")
        return result

    formatted_data = []
    api_ids = []
    now_iso = utc_now_iso()

    for p in policies:
        pid = (p.get("id") or "").strip()
        if not pid:
            continue

        title = p.get("title", "이름 없음")
        provider = p.get("provider", "주관기관 없음")
        category = p.get("category", "청년정책")
        # 🟢 [수정 7] 해시는 잘리지 않은 raw_summary 기준
        raw_summary = p.pop("_raw_summary", p.get("summary", ""))

        content_str = f"{title}{provider}{category}{raw_summary}"
        # 🟢 [수정 10] MD5 → SHA1 (충돌 확률 ↓)
        content_hash = hashlib.sha1(content_str.encode("utf-8")).hexdigest()

        p["content_hash"] = content_hash
        # 🟢 [수정 9] updated_at은 sync 단계에서만 부여
        p["updated_at"] = now_iso

        formatted_data.append(p)
        api_ids.append(pid)

    # 기존 DB 해시 조회
    db_hash_map = {}
    if api_ids:
        try:
            existing = (
                supabase.table("policies")
                .select("id, content_hash")
                .in_("id", api_ids)
                .execute()
            )
            db_hash_map = {r["id"]: r.get("content_hash") for r in existing.data}
        except Exception as e:
            print(f"⚠️ DB 지문 조회 에러: {e}")

    needs_embedding = [
        d for d in formatted_data
        if d["id"] not in db_hash_map or db_hash_map[d["id"]] != d["content_hash"]
    ]
    result["skipped"] = len(formatted_data) - len(needs_embedding)

    if not needs_embedding:
        print(f"    ⏩ {len(policies)}개 중 변경된 데이터 없음. (비용 0원 스킵!)")
        result["success"] = True
        return result

    print(f"🤖 {len(policies)}개 중 변경된 {len(needs_embedding)}개만 임베딩 변환 중...")

    # 🟢 [수정 6] 임베딩을 더 작은 청크로 격리 (1개 실패가 전체 페이지 날리는 것 방지)
    EMBED_CHUNK = 20
    embed_failed_ids = set()

    for i in range(0, len(needs_embedding), EMBED_CHUNK):
        chunk = needs_embedding[i : i + EMBED_CHUNK]
        try:
            texts = [
                f"정책명: {d['title']} 주관: {d['provider']} "
                f"카테고리: {d['category']} 내용: {d['summary']}"
                for d in chunk
            ]
            vectors = embeddings.embed_documents(texts)
            for j, d in enumerate(chunk):
                d["embedding"] = vectors[j]
        except Exception as e:
            print(f"    ❌ 임베딩 청크 실패 ({i}~{i+len(chunk)}): {e}")
            for d in chunk:
                embed_failed_ids.add(d["id"])

    # 임베딩 실패한 건 저장 대상에서 제외
    upsert_targets = [d for d in needs_embedding if d["id"] not in embed_failed_ids]
    result["failed"] += len(embed_failed_ids)

    if not upsert_targets:
        print("    ❌ 임베딩 전건 실패 → 저장 단계 스킵")
        return result

    # DB 청크 단위 저장
    DB_CHUNK = 50
    total = len(upsert_targets)

    for i in range(0, total, DB_CHUNK):
        chunk = upsert_targets[i : i + DB_CHUNK]
        db_success = False

        for db_attempt in range(3):
            try:
                supabase.table("policies").upsert(chunk, on_conflict="id").execute()
                db_success = True
                break
            except Exception as e:
                wait = 2 ** db_attempt
                print(f"    ⚠️ DB 저장 지연 (시도 {db_attempt+1}/3) - {wait}초 대기: {e}")
                time.sleep(wait)

        if db_success:
            result["saved"] += len(chunk)
            print(f"    ㄴ 저장 완료: {min(i + DB_CHUNK, total)} / {total}")
        else:
            result["failed"] += len(chunk)
            failed_titles = [item.get("title", "") for item in chunk[:3]]
            print(
                f"    ❌ DB 청크 최종 실패! 유실 데이터 일부: "
                f"{failed_titles} ... 등 {len(chunk)}개"
            )

        # 🟢 [수정 12] sleep 1초로 단축
        time.sleep(1)

    # 🟢 [수정 2] 부분 실패 정확히 반영
    result["success"] = result["failed"] == 0
    return result


# ==============================================================================
# 🟢 메인 수집 함수
# ==============================================================================
def fetch_youth_data():
    print("🚀 [청년 파이프라인] 온라인청년센터 데이터 수집 시작")

    if not YOUTH_API_KEY:
        print("❌ YOUTH_POLICY_API_KEY가 없습니다.")
        return

    page = 1
    display = 100
    total_saved = 0
    total_failed = 0
    total_skipped = 0
    consecutive_fails = 0
    empty_page_count = 0

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }

    while True:
        print(f"\n🔄 청년정책 {page}페이지 수집 중...")

        # 🌟 [파라미터 변경] 신규 API 스펙에 맞게 전부 교체
        # 기존: openApiVcyKey / display / pageIndex / returnType
        # 신규: apiKeyNm / pageSize / pageNum / rtnType / pageType
        params = {
            "apiKeyNm": YOUTH_API_KEY,
            "pageSize": display,
            "pageNum": page,
            "rtnType": "json",
            "pageType": "1",  # 1=목록, 2=상세
        }

        max_retries = 3
        fetch_success = False
        youth_list = []
        force_stop = False  # 🟢 [수정 5] 403 발생 시 전체 종료 플래그

        for attempt in range(max_retries):
            try:
                response = requests.get(
                    YOUTH_CENTER_URL, params=params, headers=headers, timeout=45
                )

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

                    except Exception:
                        print("⚠️ JSON 파싱 실패 → XML 파싱 시도로 전환!")
                        try:
                            root = ET.fromstring(response.text)
                            # XML 태그명은 실제 응답 구조에 따라 조정 필요
                            items = root.findall(".//emp") or root.findall(
                                ".//youthPolicyList"
                            )
                            print(f"🔍 [XML Fallback] 탐색된 정책 수: {len(items)}")

                            youth_list = []
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
                                    # 🟢 [수정 1] 신청기간 관련 필드들 보강
                                    "aplyYmd": item.findtext("aplyYmd", ""),
                                    "bizPrdBgngYmd": item.findtext("bizPrdBgngYmd", ""),
                                    "bizPrdEndYmd": item.findtext("bizPrdEndYmd", ""),
                                    "aplyPrdSeCd": item.findtext("aplyPrdSeCd", ""),
                                })
                            fetch_success = True
                            break
                        except Exception as xml_err:
                            print(f"❌ XML 파싱도 실패: {xml_err}")

                elif response.status_code == 403:
                    # 🟢 [수정 5] 403은 IP/키 차단 신호 → 즉시 전체 종료
                    print("❌ 403 Forbidden: IP/키 차단 의심. 전체 수집 중단합니다.")
                    force_stop = True
                    break

                else:
                    # 🟢 [수정 4] 그 외 비정상 응답에도 백오프 적용
                    wait = 2 ** attempt
                    print(
                        f"⚠️ 비정상 응답 코드 {response.status_code} → {wait}초 후 재시도"
                    )
                    time.sleep(wait)

            except Exception as e:
                wait = 2 ** attempt
                print(f"⚠️ API 통신 오류 (시도 {attempt+1}): {e} → {wait}초 대기")
                time.sleep(wait)

        if force_stop:
            break

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
            empty_page_count = 0

            policies = []
            for p in youth_list:
                provider_code = p.get("pvsnInstGroupCd", "")
                if provider_code == "0054001":
                    provider_name = "중앙부처"
                elif provider_code == "0054002":
                    provider_name = "지자체"
                else:
                    provider_name = "청년정책"

                category_name = (
                    f"{p.get('lclsfNm', '')} > {p.get('mclsfNm', '')}".strip(" > ")
                )

                # 🟢 [수정 1] deadline은 사람이 읽을 수 있는 신청기간 우선,
                #            없으면 사업운영기간으로 fallback
                deadline = p.get("aplyYmd", "").strip()
                if not deadline:
                    bgn = p.get("bizPrdBgngYmd", "").strip()
                    end = p.get("bizPrdEndYmd", "").strip()
                    if bgn or end:
                        deadline = f"{bgn} ~ {end}".strip()
                if not deadline:
                    deadline = "상시/기간확인"

                # 🟢 [수정 5,7] 원본/잘린 summary 분리 (해시는 raw 기준)
                raw_summary = (
                    f"{p.get('plcyExplnCn', '')}\n\n"
                    f"[지원내용]\n{p.get('plcySprtCn', '')}"
                ).strip()
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
                    "deadline": deadline,
                    "is_active": True,
                    # 🟢 [수정 9] updated_at은 sync_to_supabase에서만 부여 (제거)
                    # 해시 계산용 raw 보관 (sync 진입 시 pop)
                    "_raw_summary": raw_summary,
                })

            # 🟢 [수정 2] 정확한 성공/실패 카운트
            res = sync_to_supabase(policies)
            total_saved += res["saved"]
            total_failed += res["failed"]
            total_skipped += res["skipped"]

            if not res["success"]:
                print(
                    f"⚠️ {page}페이지 부분 실패 - "
                    f"saved={res['saved']}, failed={res['failed']}, "
                    f"skipped={res['skipped']}"
                )

            time.sleep(1.5)
            page += 1

    print(
        f"\n🎉 [청년 파이프라인] 동기화 완료! "
        f"saved={total_saved}, failed={total_failed}, skipped={total_skipped}\n"
    )

    # 🌟 [최종 진화형 안전장치] 진짜 "비정상 API 장애"만 정밀 타격하여 발동
    # 청년 정책 ID는 "20YYMMDD..." 정확히 20자리 숫자 패턴
    # (이전 R% 가정은 잘못된 것으로 검증됨 — 실제 ID는 plcyNo 형식)
    if (consecutive_fails >= 3 and total_saved == 0) or (total_saved < 50 and consecutive_fails > 0):
        print(f"⚠️ 청년 API 이상 감지! (안전장치 발동)")
        print(f"   - 실제 DB 저장(변경)량: {total_saved}개")
        print(f"   - 연속 실패 횟수: {consecutive_fails}회")
        print(f"   - 실패 데이터 수: {total_failed}개")
        print(f"   - 중단된 페이지: {page}페이지")

        try:
            if supabase:
                # 🌟 RPC 호출 — 정규식 ^20[0-9]{18}$ + provider 화이트리스트 이중 검증
                # is_active=True 부활까지 한 번에 처리, 정확한 영향 행 수 반환
                result = supabase.rpc("revive_youth_policies").execute()
                protected_count = result.data if isinstance(result.data, int) else 0

                print(f"🛡️ 생명 연장 완료. 부활된 청년 정책: {protected_count}개")

                if protected_count == 0:
                    print(f"   ℹ️ DB에 청년 정책이 0개입니다.")
                    print(f"   → 청년 API가 아직 한 번도 성공한 적 없거나 ID 패턴이 변경됨.")
                else:
                    print(f"   → 청년 정책이 welfare cleanup에 의해 잘못 비활성화되는 것을 방지했습니다.")
        except Exception as e:
            print(f"⚠️ 안전장치 가동 중 오류 발생: {e}")
            import traceback
            print(traceback.format_exc())


if __name__ == "__main__":
    fetch_youth_data()
