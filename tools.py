from langchain_core.tools import tool
from ddgs import DDGS
import os
import platform
import re
from datetime import datetime
from html import unescape
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, urlunparse
from urllib.request import Request, urlopen
import pytz

# 🌟 [DB 연동] openai_service.py에서 사용하던 DB 검색 함수를 여기서 바로 불러옵니다!
try:
    from chat_db import search_policies
except ImportError:
    search_policies = None

def setup_windows_ssl_env():
    """
    수동 PEM 번들은 기본값으로 강제하지 않습니다.
    사내망/학교망에서는 OS 신뢰 저장소(truststore)가 더 잘 맞는 경우가 많습니다.

    정말 수동 번들이 필요할 때만 아래 환경변수를 켜서 사용합니다.
    - POLICY_NAVIGATOR_USE_MANUAL_CA_BUNDLE=1
    - POLICY_NAVIGATOR_CA_BUNDLE_PATH=C:\cert\cacert.pem
    """
    if platform.system() != "Windows":
        return

    use_manual_bundle = os.getenv("POLICY_NAVIGATOR_USE_MANUAL_CA_BUNDLE", "0").strip() == "1"
    if not use_manual_bundle:
        return

    cert_path = os.getenv("POLICY_NAVIGATOR_CA_BUNDLE_PATH", r"C:\cert\cacert.pem").strip()

    if not cert_path or not os.path.exists(cert_path):
        return

    os.environ["SSL_CERT_FILE"] = cert_path
    os.environ["CURL_CA_BUNDLE"] = cert_path
    os.environ["REQUESTS_CA_BUNDLE"] = cert_path


setup_windows_ssl_env()


OFFICIAL_DOMAIN_SUFFIXES = (
    ".go.kr",
    ".gov.kr",
    ".or.kr",
    ".ac.kr",
)
EXCLUDED_HOST_KEYWORDS = (
    "blog.naver.com",
    "cafe.naver.com",
    "post.naver.com",
    "tistory.com",
    "youtube.com",
    "youtu.be",
    "instagram.com",
    "facebook.com",
    "x.com",
    "twitter.com",
)
POLICY_KEYWORDS = (
    "정책",
    "지원",
    "지원금",
    "지원사업",
    "복지",
    "혜택",
    "공고",
    "모집",
    "신청",
    "장학",
    "주거",
    "월세",
    "전세",
    "금융",
    "대출",
    "일자리",
    "취업",
    "창업",
    "교육",
    "문화",
    "건강",
)
APPLY_KEYWORDS = (
    "신청",
    "접수",
    "모집",
    "공고",
    "지원 대상",
    "신청 대상",
    "자격",
    "신청 기간",
    "접수 기간",
)
ENDED_KEYWORDS = (
    "마감",
    "종료",
    "접수마감",
    "접수 종료",
    "신청마감",
    "신청 종료",
    "마감되었습니다",
)
OPEN_ENDED_KEYWORDS = (
    "상시",
    "예산 소진 시까지",
    "예산소진시까지",
    "선착순",
    "수시",
)
DATE_PATTERN = re.compile(
    r"(?:20\d{2}|19\d{2})[./-]\s?\d{1,2}[./-]\s?\d{1,2}|(?:20\d{2}|19\d{2})년\s?\d{1,2}월\s?\d{1,2}일"
)
REQUEST_TIMEOUT_SECONDS = 8
MAX_FETCH_BYTES = 250000
MAX_VERIFICATION_SNIPPET_CHARS = 1200
PER_QUERY_LIMIT = 3
INITIAL_VARIANT_COUNT = 3
MAX_VARIANT_COUNT = 6
INITIAL_MIN_RESULT_COUNT = 5
INITIAL_MIN_OFFICIAL_COUNT = 2
AUTO_VERIFY_LIMIT = 2
FINAL_RESULT_LIMIT = 10

VERIFY_CACHE_TTL_SECONDS = 600
SEARCH_CACHE_TTL_SECONDS = 180
VERIFY_CACHE: dict[str, dict] = {}
SEARCH_CACHE: dict[str, dict] = {}


def get_cache_now_ts() -> float:
    return datetime.now().timestamp()


def get_cached_item(cache: dict, key: str, ttl_seconds: int):
    item = cache.get(key)
    if not item:
        return None

    cached_at = item.get("cached_at", 0)
    if get_cache_now_ts() - cached_at > ttl_seconds:
        cache.pop(key, None)
        return None

    return item.get("value")


def set_cached_item(cache: dict, key: str, value):
    cache[key] = {
        "cached_at": get_cache_now_ts(),
        "value": value,
    }


def normalize_query_text(text: str) -> str:
    return " ".join((text or "").split()).strip()


def normalize_url(url: str) -> str:
    if not url:
        return ""

    parsed = urlparse(url)
    cleaned = parsed._replace(fragment="")
    path = cleaned.path.rstrip("/")
    cleaned = cleaned._replace(path=path)
    return urlunparse(cleaned)


def get_hostname(url: str) -> str:
    try:
        return (urlparse(url).netloc or "").lower()
    except Exception:
        return ""


def is_official_domain(url: str) -> bool:
    host = get_hostname(url)
    if not host:
        return False
    return host.endswith(OFFICIAL_DOMAIN_SUFFIXES)


def is_excluded_noise_domain(url: str) -> bool:
    host = get_hostname(url)
    if not host:
        return False

    for keyword in EXCLUDED_HOST_KEYWORDS:
        if keyword in host:
            return True
    return False


def looks_like_policy_result(title: str, body: str, url: str) -> bool:
    text = f"{title} {body} {url}".lower()
    for keyword in POLICY_KEYWORDS:
        if keyword in text:
            return True
    return False


def build_query_variants(query: str) -> list[str]:
    base_query = normalize_query_text(query)
    if not base_query:
        return []

    current_year = datetime.now().year
    variants = []

    def add(text: str):
        normalized = normalize_query_text(text)
        if normalized and normalized not in variants:
            variants.append(normalized)

    add(base_query)
    add(f"{base_query} 정책 지원금 지원사업")
    add(f"{base_query} 공공기관 지자체 정부 혜택")
    add(f"{base_query} site:go.kr")
    add(f"{base_query} 신청 가능한 지원사업 공고")
    add(f"{base_query} {current_year} 정책 지원 신청")

    if "site:" not in base_query.lower():
        add(f"{base_query} site:or.kr")

    return variants[:MAX_VARIANT_COUNT]


def split_query_variants(query_variants: list[str]) -> tuple[list[str], list[str]]:
    initial = query_variants[:INITIAL_VARIANT_COUNT]
    expanded = query_variants[INITIAL_VARIANT_COUNT:]
    return initial, expanded


def get_query_token_bonus(base_query: str, title: str, body: str) -> int:
    searchable = f"{title} {body}".lower()
    tokens = [token for token in normalize_query_text(base_query).lower().split() if len(token) >= 2]
    bonus = 0

    for token in tokens[:8]:
        if token in searchable:
            bonus += 1

    return bonus


def score_result(base_query: str, title: str, body: str, url: str) -> int:
    score = 0

    if is_official_domain(url):
        score += 6

    if looks_like_policy_result(title, body, url):
        score += 3

    if is_excluded_noise_domain(url):
        score -= 6

    snippet_text = f"{title} {body}"

    if contains_any_keyword(snippet_text, APPLY_KEYWORDS):
        score += 2

    if contains_any_keyword(snippet_text, ENDED_KEYWORDS):
        if not contains_any_keyword(snippet_text, OPEN_ENDED_KEYWORDS):
            score -= 3

    score += min(get_query_token_bonus(base_query, title, body), 6)
    return score


def collect_search_results(query_variants: list[str], per_query_limit: int = PER_QUERY_LIMIT) -> list[dict]:
    collected = []

    with DDGS() as ddgs:
        for variant in query_variants:
            try:
                results = list(ddgs.text(variant, max_results=per_query_limit))
            except Exception:
                continue

            for result in results:
                title = (result.get("title") or "").strip()
                href = (result.get("href") or "").strip()
                body = (result.get("body") or "").strip()

                if not href:
                    continue

                collected.append({
                    "title": title,
                    "href": href,
                    "body": body,
                    "found_by": variant,
                })

    return collected


def deduplicate_results(base_query: str, results: list[dict]) -> list[dict]:
    best_by_url = {}

    for result in results:
        normalized_url = normalize_url(result["href"])
        if not normalized_url:
            continue

        title = result["title"]
        body = result["body"]
        found_by = result["found_by"]
        score = score_result(base_query, title, body, normalized_url)

        existing = best_by_url.get(normalized_url)
        if existing is None:
            best_by_url[normalized_url] = {
                "title": title,
                "href": normalized_url,
                "body": body,
                "score": score,
                "found_by": [found_by],
                "verification": None,
            }
            continue

        if found_by not in existing["found_by"]:
            existing["found_by"].append(found_by)

        if score > existing["score"]:
            existing["title"] = title
            existing["body"] = body
            existing["score"] = score

    deduped = list(best_by_url.values())
    sort_results_in_place(deduped)
    return deduped


def sort_results_in_place(results: list[dict]):
    results.sort(
        key=lambda item: (
            item.get("score", 0),
            1 if is_official_domain(item.get("href", "")) else 0,
            len(item.get("found_by", [])),
        ),
        reverse=True,
    )


def count_official_results(results: list[dict]) -> int:
    count = 0
    for result in results:
        if is_official_domain(result.get("href", "")):
            count += 1
    return count


def should_expand_search(results: list[dict]) -> bool:
    if len(results) < INITIAL_MIN_RESULT_COUNT:
        return True
    if count_official_results(results) < INITIAL_MIN_OFFICIAL_COUNT:
        return True
    return False


def decode_response_bytes(raw: bytes) -> str:
    for encoding in ("utf-8", "utf-8-sig", "cp949", "euc-kr"):
        try:
            return raw.decode(encoding)
        except Exception:
            continue
    return raw.decode("utf-8", errors="ignore")


def html_to_text(html_content: str) -> str:
    cleaned = re.sub(r"(?is)<script.*?>.*?</script>", " ", html_content)
    cleaned = re.sub(r"(?is)<style.*?>.*?</style>", " ", cleaned)
    cleaned = re.sub(r"(?is)<noscript.*?>.*?</noscript>", " ", cleaned)
    cleaned = re.sub(r"(?s)<[^>]+>", " ", cleaned)
    cleaned = unescape(cleaned)
    cleaned = re.sub(r"[ \t\r\f\v]+", " ", cleaned)
    cleaned = re.sub(r"\n+", "\n", cleaned)
    return cleaned.strip()


def contains_any_keyword(text: str, keywords: tuple[str, ...]) -> bool:
    for keyword in keywords:
        if keyword in text:
            return True
    return False


def extract_date_examples(text: str, limit: int = 5) -> list[str]:
    found = []
    for match in DATE_PATTERN.finditer(text):
        value = normalize_query_text(match.group(0))
        if value and value not in found:
            found.append(value)
        if len(found) >= limit:
            break
    return found


def verify_page_details(url: str) -> dict:
    normalized_url = normalize_url(url)
    if not normalized_url:
        return {
            "status": "error",
            "url": "",
            "official": False,
            "content_type": "",
            "has_apply_signal": False,
            "has_end_signal": False,
            "has_open_ended_signal": False,
            "date_examples": [],
            "snippet": "",
            "message": "검증할 URL이 비어 있습니다.",
        }

    cached_verification = get_cached_item(VERIFY_CACHE, normalized_url, VERIFY_CACHE_TTL_SECONDS)
    if cached_verification is not None:
        return cached_verification

    try:
        request = Request(
            normalized_url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
                )
            },
        )
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            final_url = normalize_url(response.geturl() or normalized_url)
            content_type = (response.headers.get("Content-Type") or "").lower()
            raw = response.read(MAX_FETCH_BYTES)
    except HTTPError as e:
        verification = {
            "status": "error",
            "url": normalized_url,
            "official": is_official_domain(normalized_url),
            "content_type": "",
            "has_apply_signal": False,
            "has_end_signal": False,
            "has_open_ended_signal": False,
            "date_examples": [],
            "snippet": "",
            "message": f"HTTP {e.code}",
        }
        set_cached_item(VERIFY_CACHE, normalized_url, verification)
        return verification
    except URLError as e:
        verification = {
            "status": "error",
            "url": normalized_url,
            "official": is_official_domain(normalized_url),
            "content_type": "",
            "has_apply_signal": False,
            "has_end_signal": False,
            "has_open_ended_signal": False,
            "date_examples": [],
            "snippet": "",
            "message": str(e.reason),
        }
        set_cached_item(VERIFY_CACHE, normalized_url, verification)
        return verification
    except Exception as e:
        verification = {
            "status": "error",
            "url": normalized_url,
            "official": is_official_domain(normalized_url),
            "content_type": "",
            "has_apply_signal": False,
            "has_end_signal": False,
            "has_open_ended_signal": False,
            "date_examples": [],
            "snippet": "",
            "message": str(e),
        }
        set_cached_item(VERIFY_CACHE, normalized_url, verification)
        return verification

    official = is_official_domain(final_url)

    if "pdf" in content_type or final_url.lower().endswith(".pdf"):
        verification = {
            "status": "pdf",
            "url": final_url,
            "official": official,
            "content_type": content_type,
            "has_apply_signal": False,
            "has_end_signal": False,
            "has_open_ended_signal": False,
            "date_examples": [],
            "snippet": "",
            "message": "PDF/첨부파일 형태라 본문 자동 검증이 제한적입니다.",
        }
        set_cached_item(VERIFY_CACHE, normalized_url, verification)
        return verification

    text = html_to_text(decode_response_bytes(raw))
    if not text:
        verification = {
            "status": "empty",
            "url": final_url,
            "official": official,
            "content_type": content_type,
            "has_apply_signal": False,
            "has_end_signal": False,
            "has_open_ended_signal": False,
            "date_examples": [],
            "snippet": "",
            "message": "본문을 읽을 수 없습니다.",
        }
        set_cached_item(VERIFY_CACHE, normalized_url, verification)
        return verification

    verification = {
        "status": "ok",
        "url": final_url,
        "official": official,
        "content_type": content_type,
        "has_apply_signal": contains_any_keyword(text, APPLY_KEYWORDS),
        "has_end_signal": contains_any_keyword(text, ENDED_KEYWORDS),
        "has_open_ended_signal": contains_any_keyword(text, OPEN_ENDED_KEYWORDS),
        "date_examples": extract_date_examples(text),
        "snippet": text[:MAX_VERIFICATION_SNIPPET_CHARS],
        "message": "",
    }
    set_cached_item(VERIFY_CACHE, normalized_url, verification)
    return verification


def verification_score_delta(verification: dict) -> int:
    status = verification.get("status")
    delta = 0

    if status == "ok":
        if verification.get("has_apply_signal"):
            delta += 4
        if verification.get("has_end_signal") and not verification.get("has_open_ended_signal"):
            delta -= 8
        if not verification.get("has_apply_signal") and not verification.get("date_examples"):
            delta -= 2
    elif status == "pdf":
        delta += 1
    elif status in ("error", "empty"):
        delta -= 2

    return delta


def select_results_for_auto_verification(results: list[dict]) -> list[dict]:
    selected = []

    for result in results:
        url = result.get("href", "")
        if not url:
            continue
        if is_excluded_noise_domain(url):
            continue
        if not is_official_domain(url):
            continue
        # 메인 페이지는 꼭 필요할 때만 검증하고, 상세 후보를 우선 확인
        if result.get("main_page") and result.get("detail_like") is not True:
            continue
        selected.append(result)
        if len(selected) >= AUTO_VERIFY_LIMIT:
            break

    if selected:
        return selected

    for result in results:
        url = result.get("href", "")
        if not url:
            continue
        if is_excluded_noise_domain(url):
            continue
        if not is_official_domain(url):
            continue
        selected.append(result)
        if len(selected) >= AUTO_VERIFY_LIMIT:
            break

    return selected


def apply_auto_verification(results: list[dict]) -> list[dict]:
    if not results:
        return results

    for result in select_results_for_auto_verification(results):
        verification = verify_page_details(result.get("href", ""))
        result["verification"] = verification
        result["score"] = result.get("score", 0) + verification_score_delta(verification)
        if verification.get("url"):
            result["href"] = verification["url"]

    sort_results_in_place(results)
    return results


def format_verification_label(verification: dict | None) -> str:
    if not verification:
        return "미실행"

    status = verification.get("status")
    if status == "error":
        return f"검증 오류 ({verification.get('message', '원인 미확인')})"
    if status == "empty":
        return "본문 확인 불가"
    if status == "pdf":
        return "PDF/첨부파일 형태"

    apply_label = "있음" if verification.get("has_apply_signal") else "없음"
    ended_label = "있음" if verification.get("has_end_signal") else "없음"
    open_label = "있음" if verification.get("has_open_ended_signal") else "없음"
    dates = verification.get("date_examples") or []
    date_label = ", ".join(dates[:3]) if dates else "없음"
    return (
        f"신청/공고 표현 {apply_label}, 종료 표현 {ended_label}, "
        f"상시/예산소진 표현 {open_label}, 날짜 예시 {date_label}"
    )


def format_search_results(results: list[dict], expanded: bool) -> str:
    if not results:
        return "검색 결과가 없습니다."

    header = [
        f"검색 모드: {'조건부 확장 검색 실행' if expanded else '기본 검색만 실행'}",
        f"후보 수: {len(results)}개",
        "",
    ]

    output = []
    for index, result in enumerate(results, start=1):
        source_label = " / ".join(result["found_by"][:2])
        if len(result["found_by"]) > 2:
            source_label += " 외"

        official_label = "예" if is_official_domain(result["href"]) else "아니오"
        verification_label = format_verification_label(result.get("verification"))

        output.append(
            f"[후보 {index}]\n"
            f"제목: {result['title']}\n"
            f"링크: {result['href']}\n"
            f"공식 사이트 추정: {official_label}\n"
            f"가벼운 재검증: {verification_label}\n"
            f"발견 검색어: {source_label}\n"
            f"내용: {result['body']}\n"
        )

    return "\n".join(header + output)


# =====================================================================
# 🌟 [도구 1] 웹 통합 검색 도구 (웹 문서 + 공식 문서 긁어오기)
# =====================================================================
@tool
def web_search(query: str):
    """
    최신 웹 정보를 검색할 때 사용하는 도구입니다.
    청년 정책, 지원금, 지자체 공지사항 등을 찾을 때 이 도구를 호출하세요.
    내부적으로 여러 쿼리를 생성하여 누락을 줄이고, 공식/공공성 높은 결과를 우선 정렬합니다.
    
    [🚨 필수 지침 🚨]
    에이전트는 사용자에게 정책 정보를 제공할 때, 이 web_search 단독으로만 의존해서는 안 됩니다.
    반드시 '내부 DB 검색 도구(search_internal_db)'와 이 'web_search'를 **모두** 사용하여 정보를 교차 검증하고 종합해서 답변하세요.
    """
    try:
        base_query = normalize_query_text(query)
        if not base_query:
            return "검색어가 비어 있습니다."

        cached_search = get_cached_item(SEARCH_CACHE, base_query, SEARCH_CACHE_TTL_SECONDS)
        if cached_search is not None:
            return cached_search

        all_variants = build_query_variants(base_query)
        initial_variants, expanded_variants = split_query_variants(all_variants)

        raw_results = collect_search_results(query_variants=initial_variants, per_query_limit=PER_QUERY_LIMIT)
        deduped_results = deduplicate_results(base_query=base_query, results=raw_results)

        expanded = False
        if expanded_variants and should_expand_search(deduped_results):
            expanded = True
            extra_results = collect_search_results(query_variants=expanded_variants, per_query_limit=2)
            deduped_results = deduplicate_results(
                base_query=base_query,
                results=raw_results + extra_results,
            )

        verified_results = apply_auto_verification(deduped_results)
        final_results = verified_results[:FINAL_RESULT_LIMIT]
        formatted = format_search_results(final_results, expanded=expanded)
        set_cached_item(SEARCH_CACHE, base_query, formatted)

        return formatted

    except Exception as e:
        return f"검색 가져오기 오류: {e}"


# =====================================================================
# 🌟 [도구 2] 팩트 체크 도구
# =====================================================================
@tool
def verify_official_page(url: str):
    """
    공식/공공기관 링크를 가볍게 재확인할 때 사용하는 도구입니다.
    상위 후보의 공식 페이지를 열어 신청/공고/마감 관련 표현과 날짜 표현이 있는지 빠르게 확인합니다.
    """
    verification = verify_page_details(url)

    return (
        f"검증 URL: {verification.get('url') or normalize_url(url)}\n"
        f"공식 사이트 추정: {'예' if verification.get('official') else '아니오'}\n"
        f"콘텐츠 유형: {verification.get('content_type') or '미확인'}\n"
        f"신청/공고 관련 표현 감지: {'예' if verification.get('has_apply_signal') else '아니오'}\n"
        f"마감/종료 표현 감지: {'예' if verification.get('has_end_signal') else '아니오'}\n"
        f"상시/예산 소진 시까지 표현 감지: {'예' if verification.get('has_open_ended_signal') else '아니오'}\n"
        f"발견 날짜 예시: {', '.join(verification.get('date_examples') or []) if verification.get('date_examples') else '없음'}\n"
        f"검증 상태: {verification.get('status')}\n"
        f"메모: {verification.get('message') or '없음'}\n"
        f"본문 일부: {verification.get('snippet') or '없음'}"
    )


# =====================================================================
# 🌟 [도구 3] 현재 시간 확인 도구
# =====================================================================
@tool
def get_current_time(timezone: str = "Asia/Seoul"):
    """타임존의 현재 날짜와 시간을 'YYYY-MM-DD HH:MM:SS' 형식으로 반환합니다."""
    try:
        tz = pytz.timezone(timezone)
        return datetime.now(tz).strftime("%Y-%m-%d %H:%M:%S") + f" {timezone}"
    except Exception as e:
        return f"시간 가져오기 오류: {e}"


# =====================================================================
# 🔥 [도구 4] 내부 DB 검색 도구 (RAG 핵심)
# =====================================================================
@tool
def search_internal_db(query: str):
    """
    [🚨 필수 지침 🚨]
    사용자의 질문과 관련된 정책을 내부 DB에서 검색하는 필수 도구입니다.
    
    1. 내부 DB를 검색할 때는 절대 완성된 문장으로 검색하지 마세요. (예: "강남구 청년 월세 지원 받을 수 있어?" -> X)
    2. 반드시 '지역명 + 타겟 + 지원종류' 형태의 2~3개 명사형 핵심 키워드 조합으로만 검색하세요. (예: "강남구 청년 월세" -> O)
    3. 결과를 찾지 못하더라도 이 도구만 단독으로 사용하지 말고, 반드시 web_search 도구와 함께 사용하여 결과를 종합하세요.
    """
    
    # 🔥 AI가 무슨 키워드로 멍청하게(?) 검색하고 있는지 백엔드 로그에서 감시하기 위해 print 추가!
    print(f"\n==============================================")
    print(f"🔥 [AI가 입력한 DB 검색어]: {query}")
    print(f"==============================================\n")
    
    try:
        if not search_policies:
            return "⚠️ 시스템 오류: DB 검색 함수(search_policies)를 불러오지 못했습니다. 서버 로그를 확인하세요."

        # 🔥 수정할 내용 3: 검색 가져오는 갯수(k)를 늘려서 넉넉하게 스캔하기 (top_k 옵션 시도)
        try:
            # 만약 chat_db.py의 search_policies 함수가 top_k(가져올 개수) 파라미터를 지원한다면 5개 호출
            result_text = search_policies(query, top_k=5)
        except TypeError:
            # 파라미터 에러 발생 시 기본값으로 호출 (보통 k=3 정도)
            result_text = search_policies(query)

        # 검색 결과가 없거나 너무 짧은 에러 메시지만 뱉은 경우
        if not result_text or len(result_text.strip()) < 10:
            return "내부 DB에서 일치하는 정책을 찾지 못했습니다. web_search 도구를 함께 사용하여 최신 정보를 검색하세요."
            
        return result_text

    except Exception as e:
        print(f"❌ [DB 검색 오류 발생]: {e}")
        return f"내부 DB 검색 중 오류가 발생했습니다: {e}"
