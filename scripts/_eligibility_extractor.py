"""정책 텍스트에서 자격 조건을 LLM으로 추출."""
import os
import json
from openai import OpenAI

_client = None

def get_openai_client():
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    return _client


EXTRACTION_PROMPT = """다음 정책 정보에서 자격 조건을 JSON으로 추출하세요. 명시되지 않은 항목은 null.

정책명: {title}
주관: {provider}
대상: {target_audience}
내용: {summary}

응답은 다음 JSON 형식만:
{{
  "age_min": 19 | null,
  "age_max": 34 | null,
  "region_sido": "서울특별시" | null,
  "region_sigungu": "강남구" | null,
  "household_types": ["1인가구"] | [],
  "housing_status": ["무주택"] | [],
  "employment_status": ["구직"] | [],
  "special_status": ["한부모"] | [],
  "deadline_date": "2026-05-31" | null
}}

규칙:
- region_sido는 "서울특별시", "부산광역시", "경기도" 등 공식 명칭
- 전국 정책은 region_sido = null
- household_types는 ["1인가구", "신혼", "한부모", "다자녀", "일반"] 중 해당
- housing_status는 ["무주택", "전세", "월세", "자가"] 중 해당
- employment_status는 ["재직", "구직", "창업", "학생"] 중 해당
- 잘 모르겠으면 null 또는 [] 사용. 추측 금지."""


def extract_eligibility(policy: dict) -> dict:
    try:
        response = get_openai_client().chat.completions.create(
            model="gpt-5.4-nano",
            messages=[{
                "role": "user",
                "content": EXTRACTION_PROMPT.format(
                    title=policy.get("title", ""),
                    provider=policy.get("provider", ""),
                    target_audience=policy.get("target_audience", ""),
                    summary=(policy.get("summary", "") or "")[:1000],
                )
            }],
            response_format={"type": "json_object"},
        )
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        print(f"⚠️ 자격 추출 실패 ({policy.get('id', '?')}): {e}")
        return {}
