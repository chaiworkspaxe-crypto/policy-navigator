"""
backfill_urls.py — NULL URL 정책에 공식 URL을 채워넣는 배치 스크립트
=========================================================================
목적: policies 테이블에서 url이 NULL인 활성 정책(~2,387건)에 대해
      네이버 검색 API로 공식 URL을 찾아 DB를 업데이트한다.
      한 번 돌리면 영구 해결 → 런타임 naver 추가 호출 불필요.

사용법:
  1) .env에 NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 설정
  2) DRY RUN (기본): python scripts/backfill_urls.py
     → DB를 변경하지 않고 결과만 출력
  3) 실제 적용:      python scripts/backfill_urls.py --apply
     → DB에 url 업데이트 반영

네이버 검색 API 일일 한도: 25,000건. 2,387건이면 1회 배치로 충분.
소요 시간: ~4분 (100ms 간격 rate limit)
"""

import os
import re
import sys
import time
import json
import requests
from datetime import datetime, timezone
from supabase import create_client, Client
from dotenv import load_dotenv

# ────────────────────────── 설정 ──────────────────────────

load_dotenv()

NAVER_CLIENT_ID = os.getenv("NAVER_CLIENT_ID")
NAVER_CLIENT_SECRET = os.getenv("NAVER_CLIENT_SECRET")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

DRY_RUN = "--apply" not in sys.argv
SLEEP_SEC = 0.12          # 네이버 API rate limit 안전 마진 (일일 25,000 → 초당 ~8.3)
DISPLAY_COUNT = 5          # 검색 결과 수 (공식 도메인 찾으면 되므로 5건이면 충분)
PAGE_SIZE = 1000           # Supabase 페이지네이션 크기
LOG_FILE = f"backfill_urls_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jsonl"

# ────────────────────────── 헬퍼 ──────────────────────────

def strip_html(text: str) -> str:
    """네이버 API 응답의 HTML 태그 제거"""
    return re.sub(r'<[^>]+>', '', text or '').strip()


def domain_tier(link: str) -> int:
    """URL의 공식성 점수 (route.ts DOMAIN_TIER 로직과 동일)"""
    if re.search(r'\.(go|or|gov)\.kr(/|$)', link, re.I):
        return 100  # 정부/공공기관
    if re.search(r'(yna\.co\.kr|kbs\.co\.kr|hani\.co\.kr|chosun\.com|donga\.com|mk\.co\.kr|ytn\.co\.kr)', link, re.I):
        return 50   # 주요 언론사
    return 10       # 기타


def title_overlap(policy_title: str, result_title: str) -> float:
    """정책 제목과 검색 결과 제목의 단어 겹침률 (0~1)"""
    p_words = set(re.findall(r'[가-힣a-zA-Z0-9]+', policy_title.lower()))
    r_words = set(re.findall(r'[가-힣a-zA-Z0-9]+', strip_html(result_title).lower()))
    if not p_words:
        return 0.0
    return len(p_words & r_words) / len(p_words)


def search_naver(query: str) -> list:
    """네이버 웹검색 API 호출 → items 리스트 반환"""
    headers = {
        'X-Naver-Client-Id': NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
    }
    params = {
        'query': query,
        'display': DISPLAY_COUNT,
        'sort': 'sim',
    }
    try:
        resp = requests.get(
            'https://openapi.naver.com/v1/search/webkr',
            headers=headers, params=params, timeout=5
        )
        resp.raise_for_status()
        return resp.json().get('items', [])
    except Exception as e:
        print(f"   ⚠️ 네이버 API 오류: {e}")
        return []


def find_best_url(title: str, provider: str) -> dict | None:
    """
    정책명 + 기관명으로 네이버 검색 → 가장 공식적인 URL을 반환.
    반환: { url, tier, overlap, result_title } 또는 None
    """
    query = f"{title} {provider} 지원 신청".strip()
    items = search_naver(query)

    if not items:
        return None

    # 점수 계산: (도메인 공식성 × 2) + (제목 겹침률 × 100)
    scored = []
    for item in items:
        link = (item.get('link') or '').strip()
        if not link:
            continue
        tier = domain_tier(link)
        overlap = title_overlap(title, item.get('title', ''))
        score = tier * 2 + overlap * 100
        scored.append({
            'url': link,
            'tier': tier,
            'overlap': round(overlap, 2),
            'score': round(score, 1),
            'result_title': strip_html(item.get('title', '')),
        })

    if not scored:
        return None

    scored.sort(key=lambda x: x['score'], reverse=True)
    best = scored[0]

    # 최소 품질 기준: 공공 도메인(tier≥100)이거나, 제목 겹침이 30% 이상
    if best['tier'] >= 100 or best['overlap'] >= 0.3:
        return best

    return None  # 품질 미달 → 안 채우는 게 더 안전


# ────────────────────────── 메인 ──────────────────────────

def main():
    print("=" * 60)
    print(f"📋 NULL URL 백필 스크립트 {'[DRY RUN]' if DRY_RUN else '[APPLY MODE]'}")
    print("=" * 60)

    # 환경변수 검증
    for name, val in [("NAVER_CLIENT_ID", NAVER_CLIENT_ID),
                      ("NAVER_CLIENT_SECRET", NAVER_CLIENT_SECRET),
                      ("SUPABASE_URL", SUPABASE_URL),
                      ("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_KEY)]:
        if not val:
            print(f"❌ {name}이 설정되지 않았습니다. .env를 확인하세요.")
            sys.exit(1)

    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

    # ── 1단계: NULL url 정책 가져오기 (페이지네이션) ──
    print("\n🔍 NULL URL 정책 가져오는 중...")
    policies = []
    offset = 0
    while True:
        resp = supabase.table('policies') \
            .select('id, title, provider, source_type') \
            .eq('is_active', True) \
            .is_('url', 'null') \
            .range(offset, offset + PAGE_SIZE - 1) \
            .execute()
        batch = resp.data or []
        policies.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    total = len(policies)
    print(f"   → {total}건 발견\n")

    if total == 0:
        print("✅ NULL URL 정책이 없습니다. 종료.")
        return

    # ── 2단계: 네이버 검색 + URL 매칭 ──
    found = 0
    not_found = 0
    errors = 0
    log_entries = []

    for i, p in enumerate(policies, 1):
        pid = p['id']
        title = (p.get('title') or '').strip()
        provider = (p.get('provider') or '').strip()

        if not title or len(title) < 3:
            print(f"  [{i}/{total}] ⏭️  제목 없음/짧음 (id={pid})")
            not_found += 1
            continue

        result = find_best_url(title, provider)

        entry = {
            'id': pid,
            'title': title,
            'provider': provider,
            'found': result is not None,
            'url': result['url'] if result else None,
            'tier': result['tier'] if result else None,
            'overlap': result['overlap'] if result else None,
            'score': result['score'] if result else None,
        }
        log_entries.append(entry)

        if result:
            tier_label = "🏛️공공" if result['tier'] >= 100 else "📄일반"
            print(f"  [{i}/{total}] ✅ {tier_label} | {title[:30]}… → {result['url'][:60]}")
            found += 1

            if not DRY_RUN:
                try:
                    supabase.table('policies') \
                        .update({'url': result['url']}) \
                        .eq('id', pid) \
                        .execute()
                except Exception as e:
                    print(f"   ❌ DB 업데이트 실패 (id={pid}): {e}")
                    errors += 1
        else:
            print(f"  [{i}/{total}] ❌ 미발견 | {title[:40]}")
            not_found += 1

        time.sleep(SLEEP_SEC)

        # 500건마다 중간 집계
        if i % 500 == 0:
            print(f"\n  --- 중간 집계 ({i}/{total}): ✅ {found} / ❌ {not_found} / 💥 {errors} ---\n")

    # ── 3단계: 결과 요약 ──
    print("\n" + "=" * 60)
    print("📊 최종 결과")
    print("=" * 60)
    print(f"  전체: {total}건")
    print(f"  ✅ URL 발견: {found}건 ({round(found/total*100, 1)}%)")
    print(f"  ❌ 미발견:   {not_found}건")
    print(f"  💥 DB 오류:  {errors}건")
    if DRY_RUN:
        print(f"\n  ⚠️  DRY RUN이었습니다. 실제 적용: python scripts/backfill_urls.py --apply")
    else:
        print(f"\n  ✅ DB에 {found - errors}건 반영 완료.")

    # ── 로그 저장 ──
    with open(LOG_FILE, 'w', encoding='utf-8') as f:
        for entry in log_entries:
            f.write(json.dumps(entry, ensure_ascii=False) + '\n')
    print(f"\n  📁 상세 로그: {LOG_FILE}")


if __name__ == '__main__':
    main()
