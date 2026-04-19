import html
import json
import re
from datetime import datetime, timedelta

import streamlit as st
import streamlit.components.v1 as components  # 🌟 자동 스크롤을 위한 컴포넌트 임포트 추가!
from dotenv import load_dotenv
from streamlit_js_eval import streamlit_js_eval

from legal_dong_loader import load_legal_dong_data

load_dotenv()

st.set_page_config(page_title="💵 전국민 맞춤형 정책 내비게이터")

from api_client import (
    api_create_thread,
    api_delete_thread,
    api_list_threads,
    api_load_inputs,
    api_load_messages,
    api_rename_thread,
    api_save_inputs,
    get_api_base_url,
    api_get_ai_response_stream, # 🌟 완벽하게 임포트 됨!
)

API_BASE_URL = get_api_base_url()

CURRENT_YEAR = datetime.now().year
BROWSER_USER_ID_KEY = "policy_navigator_browser_user_id_v1"
BROWSER_TAB_ID_KEY = "policy_navigator_browser_tab_id_v1"
MOBILE_LAYOUT_BREAKPOINT = 768

RAW_RECENT_MESSAGE_COUNT = 6
SUMMARY_USER_MAX_CHARS = 220
SUMMARY_ASSISTANT_MAX_CHARS = 320
SUMMARY_USER_ITEM_LIMIT = 3
SUMMARY_ASSISTANT_ITEM_LIMIT = 3


def run_js_eval(js_expressions: str, key_base: str, want_output: bool = False):
    return streamlit_js_eval(
        js_expressions=js_expressions,
        want_output=want_output,
        key=key_base
    )


# 💡 [최적화] JS 호출을 매번 하지 않도록 캐싱 로직 강화
def get_viewport_width() -> int:
    if "viewport_width" in st.session_state:
        return st.session_state["viewport_width"]

    result = run_js_eval(
        js_expressions="""
        (() => {
            return window.innerWidth || document.documentElement.clientWidth || 1200;
        })()
        """,
        key_base="viewport_width_reader",
        want_output=True
    )

    if result is not None:
        try:
            width = int(float(result))
            st.session_state["viewport_width"] = width
            return width
        except Exception:
            pass

    return 1200


def is_mobile_layout() -> bool:
    return get_viewport_width() <= MOBILE_LAYOUT_BREAKPOINT


def inject_custom_css():
    st.markdown(
        """
        <style>
        section[data-testid="stSidebar"] .block-container {
            padding-top: 1rem;
            padding-bottom: 1.25rem;
        }

        section[data-testid="stSidebar"] .stButton > button {
            height: 42px;
            border-radius: 12px;
            font-weight: 600;
            white-space: nowrap;
        }

        section[data-testid="stSidebar"] .stTextInput input {
            border-radius: 12px;
        }

        .thread-section-title {
            font-size: 0.84rem;
            font-weight: 700;
            color: rgba(245, 245, 245, 0.72);
            margin-top: 0.4rem;
            margin-bottom: 0.55rem;
            letter-spacing: 0.01em;
        }

        .thread-card {
            padding: 0.2rem 0 0.9rem 0;
        }

        .thread-badge {
            display: inline-block;
            padding: 0.24rem 0.62rem;
            border-radius: 999px;
            background: rgba(127, 127, 127, 0.14);
            color: #F5F5F5;
            border: 1px solid rgba(127, 127, 0.18);
            font-size: 0.76rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
        }

        .thread-meta {
            color: rgba(245, 245, 245, 0.62);
            font-size: 0.83rem;
            margin-top: 0.4rem;
            margin-bottom: 0.6rem;
        }

        .thread-divider {
            height: 1px;
            background: rgba(127, 127, 127, 0.16);
            margin-top: 0.85rem;
            margin-bottom: 0.15rem;
        }

        .rename-label {
            font-size: 0.88rem;
            font-weight: 600;
            margin-top: 0.2rem;
            margin-bottom: 0.35rem;
        }

        .delete-confirm-card {
            padding: 0.85rem 0.9rem;
            border-radius: 14px;
            background: rgba(250, 204, 21, 0.10);
            border: 1px solid rgba(250, 204, 21, 0.18);
            margin-top: 0.25rem;
            margin-bottom: 0.2rem;
        }

        .delete-confirm-title {
            font-size: 0.88rem;
            font-weight: 700;
            color: #FDE68A;
            margin-bottom: 0.25rem;
        }

        .delete-confirm-desc {
            font-size: 0.8rem;
            color: rgba(245, 245, 245, 0.78);
            line-height: 1.55;
            margin-bottom: 0.7rem;
        }

        .notice-card {
            padding: 1rem 1.05rem;
            border-radius: 16px;
            color: #F5F5F5;
            line-height: 1.68;
            margin: 0.45rem 0 0.75rem 0;
            border: 1px solid rgba(255, 255, 255, 0.08);
            box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.02) inset;
        }

        .notice-card.notice-info {
            background: linear-gradient(
                180deg,
                rgba(24, 46, 84, 0.95) 0%,
                rgba(17, 34, 61, 0.95) 100%
            );
            border: 1px solid rgba(96, 165, 250, 0.22);
            box-shadow: inset 4px 0 0 #60A5FA;
        }

        .notice-card.notice-caution {
            background: linear-gradient(
                180deg,
                rgba(63, 52, 18, 0.95) 0%,
                rgba(48, 40, 13, 0.95) 100%
            );
            border: 1px solid rgba(250, 204, 21, 0.20);
            box-shadow: inset 4px 0 0 #FACC15;
        }

        .notice-card-title {
            font-size: 0.95rem;
            font-weight: 700;
            margin-bottom: 0.35rem;
        }

        .example-card {
            padding: 1rem 1.05rem;
            border-radius: 16px;
            color: #F5F5F5;
            line-height: 1.72;
            margin: 0.45rem 0 0.85rem 0;
            background: linear-gradient(
                180deg,
                rgba(16, 52, 45, 0.96) 0%,
                rgba(12, 38, 34, 0.96) 100%
            );
            border: 1px solid rgba(45, 212, 191, 0.20);
            box-shadow: inset 4px 0 0 #2DD4BF;
        }

        .example-card-title {
            font-size: 0.95rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
        }

        .example-list {
            margin: 0;
            padding-left: 1.15rem;
        }

        .example-list li {
            margin-bottom: 0.35rem;
        }

        .example-list li:last-child {
            margin-bottom: 0;
        }

        .preview-card {
            padding: 0.95rem 1rem;
            border-radius: 16px;
            background: #17181B;
            color: #F5F5F5;
            border: 1px solid rgba(255, 255, 255, 0.08);
            line-height: 1.7;
            margin-top: 0.6rem;
            margin-bottom: 0.7rem;
        }

        .preview-line {
            margin-bottom: 0.4rem;
        }

        .preview-line:last-child {
            margin-bottom: 0;
        }

        .preview-label {
            font-weight: 700;
            color: #F5F5F5;
        }

        .helper-caption {
            color: rgba(245, 245, 245, 0.62);
            font-size: 0.88rem;
            margin-top: 0.4rem;
        }

        .download-caption {
            color: rgba(245, 245, 245, 0.62);
            font-size: 0.82rem;
            margin-top: 0.35rem;
        }

        .message-label {
            display: inline-block;
            padding: 0.22rem 0.58rem;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.07);
            color: #E5E7EB;
            border: 1px solid rgba(255, 255, 255, 0.08);
            font-size: 0.76rem;
            font-weight: 700;
            margin-bottom: 0.55rem;
        }

        .message-label.user-search {
            background: rgba(45, 212, 191, 0.12);
            border-color: rgba(45, 212, 191, 0.22);
            color: #CCFBF1;
        }

        .message-label.user-followup {
            background: rgba(148, 163, 184, 0.12);
            border-color: rgba(148, 163, 184, 0.22);
            color: #E2E8F0;
        }

        .result-header-card {
            padding: 0.9rem 1rem;
            border-radius: 16px;
            background: #17181B;
            border: 1px solid rgba(255, 255, 255, 0.08);
            margin-bottom: 0.8rem;
        }

        .result-header-title {
            font-size: 0.98rem;
            font-weight: 700;
            color: #F5F5F5;
            margin-bottom: 0.45rem;
        }

        .result-chip-wrap {
            display: flex;
            flex-wrap: wrap;
            gap: 0.45rem;
            margin-bottom: 0.45rem;
        }

        .result-chip {
            display: inline-block;
            padding: 0.22rem 0.58rem;
            border-radius: 999px;
            font-size: 0.76rem;
            font-weight: 700;
            border: 1px solid rgba(255, 255, 255, 0.10);
            color: #E5E7EB;
            background: rgba(255, 255, 255, 0.05);
        }

        .result-chip.ok {
            background: rgba(45, 212, 191, 0.12);
            border-color: rgba(45, 212, 191, 0.22);
            color: #CCFBF1;
        }

        .result-chip.muted {
            background: rgba(148, 163, 184, 0.12);
            border-color: rgba(148, 163, 184, 0.20);
            color: #E2E8F0;
        }

        .result-header-desc {
            color: rgba(245, 245, 245, 0.72);
            font-size: 0.86rem;
            line-height: 1.6;
        }

        .fold-card {
            margin: 0.45rem 0 0.8rem 0;
            border-radius: 18px;
            overflow: hidden;
            border: 1px solid rgba(255, 255, 255, 0.08);
        }

        .fold-card summary {
            list-style: none;
            cursor: pointer;
            padding: 1rem 1.1rem;
            font-size: 0.96rem;
            font-weight: 700;
            color: #F5F5F5;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .fold-card summary::-webkit-details-marker {
            display: none;
        }

        .fold-card summary::after {
            content: "열기";
            font-size: 0.8rem;
            font-weight: 600;
            color: rgba(245, 245, 245, 0.72);
        }

        .fold-card[open] summary::after {
            content: "닫기";
        }

        .fold-card .fold-card-content {
            padding: 0 1.1rem 1rem 1.1rem;
            color: #F5F5F5;
            line-height: 1.7;
        }

        .fold-card .fold-card-content p {
            margin: 0;
        }

        .fold-card.notice-info {
            background: linear-gradient(
                180deg,
                rgba(24, 46, 84, 0.95) 0%,
                rgba(17, 34, 61, 0.95) 100%
            );
            border: 1px solid rgba(96, 165, 250, 0.22);
            box-shadow: inset 4px 0 0 #60A5FA;
        }

        .fold-card.notice-caution {
            background: linear-gradient(
                180deg,
                rgba(63, 52, 18, 0.95) 0%,
                rgba(48, 40, 13, 0.95) 100%
            );
            border: 1px solid rgba(250, 204, 21, 0.20);
            box-shadow: inset 4px 0 0 #FACC15;
        }

        .fold-card.notice-caution summary::after,
        .fold-card.notice-info summary::after {
            color: rgba(245, 245, 245, 0.72);
        }

        .fold-card.example-card {
            background: linear-gradient(
                180deg,
                rgba(16, 52, 45, 0.96) 0%,
                rgba(12, 38, 34, 0.96) 100%
            );
            border: 1px solid rgba(45, 212, 191, 0.20);
            box-shadow: inset 4px 0 0 #2DD4BF;
        }

        .fold-card .example-list {
            margin: 0;
            padding-left: 1.15rem;
        }

        .fold-card .example-list li {
            margin-bottom: 0.35rem;
        }

        .fold-card .example-list li:last-child {
            margin-bottom: 0;
        }

        .support-card {
            position: relative;
            padding: 1.05rem 1rem 1rem 1rem;
            border-radius: 20px;
            background:
                radial-gradient(circle at top right, rgba(255, 215, 64, 0.35) 0%, rgba(255, 215, 64, 0.0) 34%),
                linear-gradient(135deg, rgba(236, 72, 153, 0.98) 0%, rgba(168, 85, 247, 0.98) 48%, rgba(59, 130, 246, 0.98) 100%);
            border: 1px solid rgba(255, 255, 255, 0.22);
            box-shadow:
                0 18px 40px rgba(168, 85, 247, 0.28),
                0 8px 18px rgba(236, 72, 153, 0.20),
                inset 0 1px 0 rgba(255, 255, 255, 0.28);
            color: #FFFFFF;
            margin-bottom: 0.9rem;
            overflow: hidden;
        }

        .support-card::before {
            content: "";
            position: absolute;
            inset: 0;
            background: linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.0) 34%);
            pointer-events: none;
        }

        .support-badge {
            display: inline-block;
            position: relative;
            z-index: 1;
            padding: 0.24rem 0.62rem;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.18);
            color: #FFF7ED;
            border: 1px solid rgba(255, 255, 255, 0.26);
            backdrop-filter: blur(6px);
            font-size: 0.76rem;
            font-weight: 800;
            letter-spacing: 0.01em;
            margin-bottom: 0.58rem;
            box-shadow: 0 6px 16px rgba(0, 0, 0, 0.10);
        }

        .support-title {
            position: relative;
            z-index: 1;
            font-size: 1.02rem;
            font-weight: 900;
            line-height: 1.35;
            color: #FFFFFF;
            margin-bottom: 0.35rem;
            text-shadow: 0 1px 8px rgba(0, 0, 0, 0.18);
        }

        .support-desc {
            position: relative;
            z-index: 1;
            font-size: 0.84rem;
            line-height: 1.62;
            color: rgba(255, 255, 255, 0.96);
            margin-bottom: 0.72rem;
        }

        .support-info-line {
            position: relative;
            z-index: 1;
            font-size: 0.84rem;
            line-height: 1.6;
            color: #FFFFFF;
            margin-bottom: 0.26rem;
            word-break: break-all;
        }

        .support-info-line strong {
            color: #FEF3C7;
            font-weight: 800;
        }

        .support-note {
            position: relative;
            z-index: 1;
            margin-top: 0.72rem;
            padding: 0.68rem 0.72rem;
            border-radius: 14px;
            background: rgba(17, 24, 39, 0.20);
            border: 1px solid rgba(255, 255, 255, 0.16);
            font-size: 0.78rem;
            line-height: 1.56;
            color: rgba(255, 255, 255, 0.95);
        }

        .support-help {
            color: rgba(245, 245, 245, 0.86);
            font-size: 0.8rem;
            font-weight: 600;
            margin-top: 0.38rem;
            margin-bottom: 0.68rem;
        }

        @media (max-width: 768px) {
            .support-card {
                padding: 0.95rem 0.92rem 0.92rem 0.92rem;
                border-radius: 18px;
            }

            .support-title {
                font-size: 0.98rem;
            }

            .support-desc,
            .support-info-line {
                font-size: 0.82rem;
            }

            .support-note {
                font-size: 0.76rem;
            }
        }

        </style>
        """,
        unsafe_allow_html=True
    )


# 🌟 스트림릿 최신 버전 & 모바일(아이폰/갤럭시) 완벽 호환 자동 스크롤
# 🌟 에이전트 타이핑(말)을 완벽하게 따라가는 AI 추적형 자동 스크롤!
def inject_auto_scroll():
    components.html(
        """
        <script>
            try {
                // AI가 글자를 치거나(노드 추가) 화면 내용이 변할 때마다 즉각 반응하는 관찰자(Observer)
                const observer = new MutationObserver((mutations) => {
                    // 스트림릿에서 스크롤을 담당할 수 있는 모든 후보를 싹 다 끌어내림
                    const viewContainer = parent.document.querySelector('[data-testid="stAppViewContainer"]');
                    const mainContainer = parent.document.querySelector('.main');
                    
                    if (viewContainer) {
                        viewContainer.scrollTo({ top: viewContainer.scrollHeight, behavior: 'smooth' });
                    }
                    if (mainContainer) {
                        mainContainer.scrollTo({ top: mainContainer.scrollHeight, behavior: 'smooth' });
                    }
                    // 만약을 대비해 브라우저 전체 창(window)도 바닥으로 내림
                    parent.window.scrollTo({ top: parent.document.body.scrollHeight, behavior: 'smooth' });
                });

                // 화면(body 또는 main)에 글자가 하나라도 추가되면 즉시 스크롤 작동!
                const targetNode = parent.document.querySelector('.main') || parent.document.body;
                observer.observe(targetNode, { 
                    childList: true, 
                    subtree: true, 
                    characterData: true 
                });
                
            } catch (e) {
                console.error("Auto-scroll failed:", e);
            }
        </script>
        """,
        height=0,
        width=0,
    )

def render_notice_card(
    text: str,
    variant: str = "info",
    title: str = "",
    expanded: bool = False
):
    safe_text = html.escape(text).replace("\n\n", "<br><br>").replace("\n", "<br>")
    class_name = "fold-card notice-info"

    if variant == "caution":
        class_name = "fold-card notice-caution"

    title_text = html.escape(title.strip()) if title.strip() else "안내"
    open_attr = " open" if expanded else ""

    st.markdown(
        f'''
        <details class="{class_name}"{open_attr}>
            <summary>{title_text}</summary>
            <div class="fold-card-content">
                <p>{safe_text}</p>
            </div>
        </details>
        ''',
        unsafe_allow_html=True
    )


def render_examples_box(expanded: bool = False):
    open_attr = " open" if expanded else ""

    st.markdown(
        f"""
        <details class="fold-card example-card"{open_attr}>
            <summary>입력 예시</summary>
            <div class="fold-card-content">
                <ul class="example-list">
                    <li>출생연도: 1999 / 추가 정보: 대학생, 1인가구, 취업 준비 중</li>
                    <li>출생연도: 1995 / 추가 정보: 중소기업 재직자, 무주택, 월세 거주</li>
                    <li>출생연도: 1997 / 추가 정보: 청년 창업 준비 중, 소득이 적음</li>
                </ul>
            </div>
        </details>
        """,
        unsafe_allow_html=True
    )


def render_preview_card(region_preview: str, birth_year_preview: str, extra_info: str):
    extra_status = "완료" if extra_info else "미입력"

    st.markdown(
        f"""
        <div class="preview-card">
            <div class="preview-line"><span class="preview-label">현재 선택 거주지:</span> {html.escape(region_preview)}</div>
            <div class="preview-line"><span class="preview-label">출생연도:</span> {html.escape(birth_year_preview)}</div>
            <div class="preview-line"><span class="preview-label">추가 정보 여부:</span> {html.escape(extra_status)}</div>
        </div>
        """,
        unsafe_allow_html=True
    )


def render_message_label(text: str, label_type: str = "neutral"):
    class_name = "message-label"
    if label_type == "user-search":
        class_name += " user-search"
    elif label_type == "user-followup":
        class_name += " user-followup"

    st.markdown(
        f'<div class="{class_name}">{html.escape(text)}</div>',
        unsafe_allow_html=True
    )


def get_assistant_result_title(message_type: str) -> str:
    if message_type == "search_result":
        return "맞춤 검색 결과"
    if message_type == "followup_answer":
        return "추가 질문 응답"
    return "응답 결과"


def render_assistant_result_header(message_type: str, has_summary: bool):
    result_title = get_assistant_result_title(message_type)
    summary_chip_class = "result-chip ok" if has_summary else "result-chip muted"
    summary_text = "요약 표 추출 가능" if has_summary else "요약 표 없음"

    st.markdown(
        f"""
        <div class="result-header-card">
            <div class="result-header-title">{html.escape(result_title)}</div>
            <div class="result-chip-wrap">
                <span class="result-chip muted">공식 정보 기반 정리</span>
                <span class="{summary_chip_class}">{html.escape(summary_text)}</span>
            </div>
            <div class="result-header-desc">
                아래 내용을 먼저 확인한 뒤, 필요하면 하단 다운로드 버튼으로 전체 응답 또는 요약 표를 저장해 주세요.
            </div>
        </div>
        """,
        unsafe_allow_html=True
    )


def get_user_message_label(message_type: str) -> tuple:
    if message_type == "structured_search":
        return "검색 조건", "user-search"
    if message_type == "followup_question":
        return "추가 질문", "user-followup"
    return "", "neutral"


def build_region_text(city: str, district: str, dong: str) -> str:
    region_text = f"{city} {district}"
    if dong and dong != "선택 안 함":
        region_text += f" {dong}"
    return region_text


def build_user_display_text(region_text: str, birth_year: str, extra_info: str) -> str:
    return (
        "📌 입력 정보\n"
        f"- 거주지: {region_text}\n"
        f"- 출생연도: {birth_year}\n"
        f"- 추가 정보: {extra_info.strip()}"
    )


def get_support_config() -> dict:
    return {
        "bank_name": "케이뱅크",
        "bank_account": "100-238-386987",
        "bank_holder": "유창현",
        "note": "후원금은 서버비, 도메인, API 비용과 검색 품질 개선에 사용됩니다.",
        "intro_text": "서비스가 도움이 되었다면 계좌이체로 일회성 후원을 할 수 있습니다. 감사합니다!",
    }


def copy_text_to_clipboard(text: str, key_base: str) -> bool:
    target_text = (text or "").strip()
    if not target_text:
        return False

    result = run_js_eval(
        js_expressions=f"""
        (async () => {{
            try {{
                await navigator.clipboard.writeText({json.dumps(target_text)});
                return "ok";
            }} catch (e) {{
                return "error:" + String(e);
            }}
        }})()
        """,
        key_base=key_base,
        want_output=True
    )

    return result == "ok"


def render_support_sidebar_section():
    support = get_support_config()
    bank_name = support["bank_name"]
    bank_account = support["bank_account"]
    bank_holder = support["bank_holder"]

    if not (bank_name and bank_account and bank_holder):
        return

    st.markdown(
        f"""
        <div class="support-card">
            <div class="support-badge">☕ 일회성 후원</div>
            <div class="support-title">서비스 운영을 후원할 수 있어요</div>
            <div class="support-desc">{html.escape(support['intro_text'])}</div>
            <div class="support-info-line"><strong>은행</strong> · {html.escape(bank_name)}</div>
            <div class="support-info-line"><strong>계좌번호</strong> · {html.escape(bank_account)}</div>
            <div class="support-info-line"><strong>예금주</strong> · {html.escape(bank_holder)}</div>
            <div class="support-note">{html.escape(support['note'])}</div>
        </div>
        """,
        unsafe_allow_html=True
    )

    if IS_MOBILE_LAYOUT:
        if st.button("📋 계좌번호 복사", key="support_copy_account", use_container_width=True):
            copied = copy_text_to_clipboard(bank_account, "copy_support_account")
            if copied:
                set_runtime_notice("후원 계좌번호를 복사했어요.")
            else:
                set_runtime_notice("브라우저에서 자동 복사를 허용하지 않아 직접 복사해 주세요.")
            st.rerun()

        combined = f"{bank_name} / {bank_holder}"
        if st.button("🏦 은행·예금주 복사", key="support_copy_bank_holder", use_container_width=True):
            copied = copy_text_to_clipboard(combined, "copy_support_bank_holder")
            if copied:
                set_runtime_notice("은행과 예금주 정보를 복사했어요.")
            else:
                set_runtime_notice("브라우저에서 자동 복사를 허용하지 않아 직접 복사해 주세요.")
            st.rerun()
    else:
        copy_col1, copy_col2 = st.columns(2)

        with copy_col1:
            if st.button("📋 계좌번호 복사", key="support_copy_account", use_container_width=True):
                copied = copy_text_to_clipboard(bank_account, "copy_support_account")
                if copied:
                    set_runtime_notice("후원 계좌번호를 복사했어요.")
                else:
                    set_runtime_notice("브라우저에서 자동 복사를 허용하지 않아 직접 복사해 주세요.")
                st.rerun()

        with copy_col2:
            combined = f"{bank_name} / {bank_holder}"
            if st.button("🏦 은행·예금주 복사", key="support_copy_bank_holder", use_container_width=True):
                copied = copy_text_to_clipboard(combined, "copy_support_bank_holder")
                if copied:
                    set_runtime_notice("은행과 예금주 정보를 복사했어요.")
                else:
                    set_runtime_notice("브라우저에서 자동 복사를 허용하지 않아 직접 복사해 주세요.")
                st.rerun()

    st.markdown('<div class="support-help">초기에는 계좌이체 방식으로만 운영하고 있어요.</div>', unsafe_allow_html=True)


def reset_district_and_dong():
    st.session_state["selected_district"] = "선택하세요"
    st.session_state["selected_dong"] = "선택 안 함"
    persist_current_inputs(force=True)


def reset_dong():
    st.session_state["selected_dong"] = "선택 안 함"
    persist_current_inputs(force=True)


def apply_thread_inputs_to_session(thread_inputs: dict):
    st.session_state["selected_city"] = thread_inputs.get("selected_city", "선택하세요")
    st.session_state["selected_district"] = thread_inputs.get("selected_district", "선택하세요")
    st.session_state["selected_dong"] = thread_inputs.get("selected_dong", "선택 안 함")
    st.session_state["birth_year"] = thread_inputs.get("birth_year", "")
    st.session_state["extra_info"] = thread_inputs.get("extra_info", "")


def get_current_input_state() -> dict:
    return {
        "selected_city": st.session_state.get("selected_city", "선택하세요"),
        "selected_district": st.session_state.get("selected_district", "선택하세요"),
        "selected_dong": st.session_state.get("selected_dong", "선택 안 함"),
        "birth_year": st.session_state.get("birth_year", ""),
        "extra_info": st.session_state.get("extra_info", "")
    }


def set_last_saved_input_state(thread_id: str, input_state: dict):
    st.session_state["last_saved_input_thread_id"] = thread_id
    st.session_state["last_saved_input_state"] = dict(input_state)


def clear_last_saved_input_state():
    st.session_state["last_saved_input_thread_id"] = ""
    st.session_state["last_saved_input_state"] = {}


def is_same_input_state(thread_id: str, input_state: dict) -> bool:
    saved_thread_id = st.session_state.get("last_saved_input_thread_id", "")
    saved_input_state = st.session_state.get("last_saved_input_state", {})

    if saved_thread_id != thread_id:
        return False

    if not isinstance(saved_input_state, dict):
        return False

    return saved_input_state == input_state


def set_runtime_notice(message: str):
    st.session_state["runtime_notice"] = message


def pop_runtime_notice() -> str:
    message = st.session_state.get("runtime_notice", "")
    st.session_state["runtime_notice"] = ""
    return message


def thread_exists_in_threads(threads: list, thread_id: str) -> bool:
    for thread in threads:
        if thread.get("thread_id") == thread_id:
            return True
    return False


def pick_valid_thread_id(threads: list, *candidate_thread_ids: str) -> str:
    for candidate_thread_id in candidate_thread_ids:
        if candidate_thread_id and thread_exists_in_threads(threads, candidate_thread_id):
            return candidate_thread_id
    return ""


def build_runtime_diagnostics() -> dict:
    user_id = st.session_state.get("browser_user_id", "")
    current_thread_id = st.session_state.get("thread_id", "")
    messages = st.session_state.get("messages", [])
    threads = api_list_threads(user_id) if user_id else []
    current_input_state = get_current_input_state()
    saved_thread_id = st.session_state.get("last_saved_input_thread_id", "")
    saved_input_state = st.session_state.get("last_saved_input_state", {})

    return {
        "browser_user_id": user_id,
        "current_thread_id": current_thread_id,
        "thread_count": len(threads),
        "current_thread_exists": thread_exists_in_threads(threads, current_thread_id),
        "message_count_in_session": len(messages) if isinstance(messages, list) else 0,
        "last_saved_input_thread_id": saved_thread_id,
        "last_saved_input_matches_current": (
            saved_thread_id == current_thread_id and saved_input_state == current_input_state
        ),
        "current_input_state": current_input_state,
        "last_saved_input_state": saved_input_state,
    }


def normalize_search_text(text: str) -> str:
    return " ".join((text or "").lower().split()).strip()


def build_thread_search_blob(thread: dict) -> str:
    parts = [
        thread.get("title", ""),
        thread.get("selected_city", ""),
        thread.get("selected_district", ""),
        thread.get("selected_dong", ""),
        thread.get("birth_year", ""),
        build_thread_meta_text(thread),
    ]
    return normalize_search_text(" ".join(parts))


def filter_threads_by_query(threads: list, query: str) -> list:
    normalized_query = normalize_search_text(query)

    if not normalized_query:
        return threads

    filtered = []
    for thread in threads:
        if normalized_query in build_thread_search_blob(thread):
            filtered.append(thread)
    return filtered


def parse_thread_updated_at(updated_at_text: str):
    try:
        return datetime.strptime(updated_at_text, "%Y-%m-%d %H:%M:%S")
    except Exception:
        return None


def group_threads_by_recency(threads: list) -> dict:
    today_threads = []
    recent_threads = []
    older_threads = []

    now = datetime.now()
    today_date = now.date()
    seven_days_ago = now - timedelta(days=7)

    for thread in threads:
        updated_at = parse_thread_updated_at(thread.get("updated_at", ""))

        if updated_at is None:
            older_threads.append(thread)
            continue

        if updated_at.date() == today_date:
            today_threads.append(thread)
        elif updated_at >= seven_days_ago:
            recent_threads.append(thread)
        else:
            older_threads.append(thread)

    return {
        "오늘": today_threads,
        "최근 7일": recent_threads,
        "이전 대화": older_threads,
    }


def sync_browser_tab_thread_id(thread_id: str):
    user_id = st.session_state.get("browser_user_id", "")
    tab_id = st.session_state.get("browser_tab_id", "")
    target_thread_id = thread_id or ""

    if not user_id or not tab_id:
        return

    if st.session_state.get("browser_tab_thread_id", "") == target_thread_id:
        return

    storage_key = f"policy_navigator_tab_thread_id_v1::{user_id}::{tab_id}"
    safe_thread_id = json.dumps(target_thread_id)

    run_js_eval(
        js_expressions=f"""
        (() => {{
            window.sessionStorage.setItem({json.dumps(storage_key)}, {safe_thread_id});
            return true;
        }})()
        """,
        key_base=f"tab_thread_sync_{target_thread_id or 'empty'}",
        want_output=False
    )

    st.session_state["browser_tab_thread_id"] = target_thread_id


def load_thread_state_to_session(thread_id: str, sync_browser_storage: bool = True):
    st.session_state["thread_id"] = thread_id
    st.session_state["messages"] = api_load_messages(
        st.session_state["browser_user_id"],
        thread_id
    )

    thread_inputs = api_load_inputs(
        st.session_state["browser_user_id"],
        thread_id
    )
    apply_thread_inputs_to_session(thread_inputs)
    set_last_saved_input_state(
        thread_id,
        thread_inputs if isinstance(thread_inputs, dict) else get_current_input_state()
    )

    if sync_browser_storage:
        sync_browser_tab_thread_id(thread_id)

    clear_clear_current_confirm()


def clear_rename_state():
    st.session_state["rename_target_thread_id"] = None
    st.session_state["rename_draft_title"] = ""


def open_delete_confirm(thread_id: str, title: str):
    st.session_state["pending_delete_thread_id"] = thread_id
    st.session_state["pending_delete_thread_title"] = title


def clear_delete_confirm():
    st.session_state["pending_delete_thread_id"] = None
    st.session_state["pending_delete_thread_title"] = ""


def open_clear_current_confirm():
    st.session_state["pending_clear_current_thread"] = True


def clear_clear_current_confirm():
    st.session_state["pending_clear_current_thread"] = False


def recover_active_thread_state(show_message: bool = False) -> bool:
    user_id = st.session_state.get("browser_user_id", "")

    if not user_id:
        if show_message:
            st.error("사용자 세션을 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요.")
        return False

    threads = api_list_threads(user_id)

    if not threads:
        fallback_thread_id = api_create_thread(user_id)
        load_thread_state_to_session(fallback_thread_id)
        clear_rename_state()
        return True

    resolved_thread_id = pick_valid_thread_id(
        threads,
        st.session_state.get("thread_id", ""),
        st.session_state.get("browser_tab_thread_id", ""),
        threads[0]["thread_id"]
    )

    if not resolved_thread_id:
        if show_message:
            st.error("현재 대화를 복구하지 못했습니다. 새로고침 후 다시 시도해 주세요.")
        return False

    load_thread_state_to_session(resolved_thread_id)
    clear_rename_state()
    clear_clear_current_confirm()

    if show_message:
        st.warning("현재 탭에서 보던 대화 상태를 다시 불러왔습니다. 다시 시도해 주세요.")

    return True


def create_and_open_new_thread(show_error: bool = False) -> bool:
    user_id = st.session_state.get("browser_user_id", "")

    if not user_id:
        if show_error:
            st.error("새 대화를 생성할 사용자 정보를 찾지 못했습니다.")
        return False

    new_thread_id = api_create_thread(user_id)

    if not load_thread_into_session(new_thread_id):
        if show_error:
            st.error("새 대화를 시작하지 못했습니다. 다시 시도해 주세요.")
        return False

    clear_delete_confirm()
    clear_clear_current_confirm()
    return True


def ensure_valid_active_thread(show_error: bool = False, show_notice: bool = False) -> bool:
    user_id = st.session_state.get("browser_user_id", "")

    if not user_id:
        if show_error:
            st.error("사용자 세션을 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요.")
        return False

    threads = api_list_threads(user_id)
    current_thread_id = st.session_state.get("thread_id", "")

    if not threads:
        created = create_and_open_new_thread(show_error=show_error)
        if created and show_notice:
            set_runtime_notice("사용 가능한 대화가 없어 새 대화를 준비했어요.")
        return created

    if thread_exists_in_threads(threads, current_thread_id):
        return True

    recovered = recover_active_thread_state(show_message=False)

    if recovered:
        threads = api_list_threads(user_id)
        current_thread_id = st.session_state.get("thread_id", "")

        if thread_exists_in_threads(threads, current_thread_id):
            if show_notice:
                set_runtime_notice("현재 대화 상태를 다시 불러왔어요.")
            return True

    first_thread_id = threads[0]["thread_id"]

    if load_thread_into_session(first_thread_id):
        if show_notice:
            set_runtime_notice("유효한 최근 대화로 자동 전환했어요.")
        return True

    created = create_and_open_new_thread(show_error=show_error)

    if created and show_notice:
        set_runtime_notice("현재 대화를 찾을 수 없어 새 대화를 준비했어요.")

    return created


def ensure_runtime_thread_state(show_error: bool = False) -> bool:
    user_id = st.session_state.get("browser_user_id", "")

    if not user_id:
        if show_error:
            st.error("사용자 세션을 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요.")
        return False

    threads = api_list_threads(user_id)

    if not threads:
        created = create_and_open_new_thread(show_error=show_error)
        return created

    current_thread_id = st.session_state.get("thread_id", "")
    current_messages = st.session_state.get("messages")

    if not isinstance(current_messages, list):
        return recover_active_thread_state(show_message=show_error)

    if thread_exists_in_threads(threads, current_thread_id):
        if st.session_state.get("browser_tab_thread_id", "") != current_thread_id:
            sync_browser_tab_thread_id(current_thread_id)
        return True

    return recover_active_thread_state(show_message=show_error)


def load_thread_into_session(thread_id: str) -> bool:
    user_id = st.session_state.get("browser_user_id", "")

    if not user_id:
        return False

    threads = api_list_threads(user_id)

    if not thread_exists_in_threads(threads, thread_id):
        return False

    load_thread_state_to_session(thread_id)
    clear_rename_state()
    clear_delete_confirm()
    clear_clear_current_confirm()
    return True


def switch_after_delete() -> bool:
    threads = api_list_threads(st.session_state["browser_user_id"])

    if threads:
        next_thread_id = threads[0]["thread_id"]
        return load_thread_into_session(next_thread_id)

    return create_and_open_new_thread(show_error=False)


def delete_thread_with_confirm(thread_id: str) -> bool:
    is_deleting_current = thread_id == st.session_state["thread_id"]

    api_delete_thread(st.session_state["browser_user_id"], thread_id)
    clear_delete_confirm()
    clear_clear_current_confirm()
    clear_rename_state()

    if is_deleting_current:
        if not switch_after_delete():
            return False
        set_runtime_notice("현재 대화를 삭제해서 다른 대화로 전환했어요.")
        return True

    set_runtime_notice("선택한 대화를 삭제했어요.")
    return True


def persist_current_inputs(show_error: bool = False, force: bool = False) -> bool:
    if not ensure_runtime_thread_state(show_error=show_error):
        return False

    thread_id = st.session_state.get("thread_id", "")
    current_input_state = get_current_input_state()

    if not force and is_same_input_state(thread_id, current_input_state):
        return True

    set_last_saved_input_state(thread_id, current_input_state)
    api_save_inputs(st.session_state.get("browser_user_id"), thread_id, current_input_state)
    return True


def is_valid_birth_year(birth_year: str) -> bool:
    text = birth_year.strip()

    if not re.fullmatch(r"\d{4}", text):
        return False

    year = int(text)
    return 1900 <= year <= CURRENT_YEAR


def contains_age_expression(text: str) -> bool:
    patterns = [
        r"만\s*\d{1,2}\s*세",
        r"\d{1,2}\s*세",
        r"\d{1,2}\s*살",
    ]

    for pattern in patterns:
        if re.search(pattern, text):
            return True

    return False


def normalize_table_line(line: str) -> str:
    return line.replace(" ", "").strip()


def is_summary_header_line(line: str) -> bool:
    normalized = normalize_table_line(line)
    required_headers = [
        "|분야|",
        "|정책명|",
        "|주관기관|",
        "|핵심혜택|",
        "|신청마감일|"
    ]

    if "|" not in normalized:
        return False

    return all(header in normalized for header in required_headers)


def is_markdown_separator_line(line: str) -> bool:
    normalized = normalize_table_line(line)

    if "|" not in normalized:
        return False

    temp = normalized.replace("|", "").replace("-", "").replace(":", "")
    return temp == ""


def extract_summary_table(text: str) -> str:
    lines = text.split("\n")
    header_index = -1

    for i, line in enumerate(lines):
        if is_summary_header_line(line):
            header_index = i
            break

    if header_index == -1:
        return ""

    table_lines = [lines[header_index]]

    for line in lines[header_index + 1:]:
        stripped = line.strip()

        if not stripped:
            if len(table_lines) >= 2:
                break
            continue

        if "|" not in line:
            if len(table_lines) >= 2:
                break
            continue

        if is_markdown_separator_line(line) or line.count("|") >= 2:
            table_lines.append(line)
        else:
            if len(table_lines) >= 2:
                break

    valid_table_lines = []
    data_row_count = 0

    for i, line in enumerate(table_lines):
        valid_table_lines.append(line)

        if i == 0:
            continue

        if is_markdown_separator_line(line):
            continue

        if line.count("|") >= 2:
            data_row_count += 1

    if data_row_count == 0:
        return ""

    return "\n".join(valid_table_lines).strip()


def get_summary_download_text(text: str) -> str:
    return extract_summary_table(text)


def sanitize_filename_component(text: str, default: str = "응답") -> str:
    cleaned = " ".join((text or "").split()).strip()

    if not cleaned:
        cleaned = default

    cleaned = re.sub(r'[\\/:*?"<>|]+', "_", cleaned)
    cleaned = cleaned.replace("\n", " ").replace("\r", " ")
    cleaned = cleaned.strip(" ._")

    if not cleaned:
        cleaned = default

    if len(cleaned) > 40:
        cleaned = cleaned[:40].rstrip()

    return cleaned


def get_current_thread_title() -> str:
    user_id = st.session_state.get("browser_user_id", "")
    thread_id = st.session_state.get("thread_id", "")

    if not user_id or not thread_id:
        return "새 대화"

    threads = api_list_threads(user_id)

    for thread in threads:
        if thread["thread_id"] == thread_id:
            return thread.get("title") or "새 대화"

    return "새 대화"


def get_assistant_sequence(message_index: int) -> int:
    count = 0

    for idx in range(message_index + 1):
        msg = st.session_state["messages"][idx]
        if msg.get("role") == "assistant":
            count += 1

    return count


def build_download_base_name(message_index: int) -> str:
    thread_title = sanitize_filename_component(get_current_thread_title(), default="대화")
    assistant_seq = get_assistant_sequence(message_index)
    return f"{thread_title}_응답{assistant_seq}"


def get_browser_context() -> dict:
    context_text = run_js_eval(
        js_expressions=f"""
        (() => {{
            const userKey = "{BROWSER_USER_ID_KEY}";
            const tabKey = "{BROWSER_TAB_ID_KEY}";
            let browserUserId = window.localStorage.getItem(userKey);

            if (!browserUserId) {{
                if (window.crypto && window.crypto.randomUUID) {{
                    browserUserId = window.crypto.randomUUID();
                }} else {{
                    browserUserId = "user_" + Date.now() + "_" + Math.random().toString(36).slice(2);
                }}
                window.localStorage.setItem(userKey, browserUserId);
            }}

            let browserTabId = window.sessionStorage.getItem(tabKey);

            if (!browserTabId) {{
                if (window.crypto && window.crypto.randomUUID) {{
                    browserTabId = window.crypto.randomUUID();
                }} else {{
                    browserTabId = "tab_" + Date.now() + "_" + Math.random().toString(36).slice(2);
                }}
                window.sessionStorage.setItem(tabKey, browserTabId);
            }}

            const threadKey = `policy_navigator_tab_thread_id_v1::${{browserUserId}}::${{browserTabId}}`;
            const browserTabThreadId = window.sessionStorage.getItem(threadKey) || "";

            return JSON.stringify({{
                browser_user_id: browserUserId,
                browser_tab_id: browserTabId,
                browser_tab_thread_id: browserTabThreadId
            }});
        }})()
        """,
        key_base="browser_context_loader",
        want_output=True
    )

    if not context_text:
        return {}

    try:
        context = json.loads(context_text)
    except Exception:
        return {}

    if not isinstance(context, dict):
        return {}

    return context


def init_app_session():
    browser_context = get_browser_context()
    browser_user_id = browser_context.get("browser_user_id", "")
    browser_tab_id = browser_context.get("browser_tab_id", "")
    browser_tab_thread_id = browser_context.get("browser_tab_thread_id", "")

    if browser_user_id in (None, "", [], 0) or browser_tab_id in (None, "", [], 0):
        st.info("브라우저 사용자 정보를 불러오는 중입니다...")
        st.stop()

    browser_identity_changed = (
        st.session_state.get("browser_user_id") != browser_user_id
        or st.session_state.get("browser_tab_id") != browser_tab_id
    )

    if browser_identity_changed:
        st.session_state["browser_user_id"] = browser_user_id
        st.session_state["browser_tab_id"] = browser_tab_id
        st.session_state["browser_tab_thread_id"] = browser_tab_thread_id
        st.session_state["thread_id"] = browser_tab_thread_id
        st.session_state["messages"] = []
        st.session_state["selected_city"] = "선택하세요"
        st.session_state["selected_district"] = "선택하세요"
        st.session_state["selected_dong"] = "선택 안 함"
        st.session_state["birth_year"] = ""
        st.session_state["extra_info"] = ""
        clear_last_saved_input_state()
        clear_rename_state()
        st.session_state["runtime_notice"] = ""
        st.session_state["pending_delete_thread_id"] = None
        st.session_state["pending_delete_thread_title"] = ""
        st.session_state["pending_clear_current_thread"] = False
        st.session_state["thread_search_query"] = ""

    defaults = {
        "selected_city": "선택하세요",
        "selected_district": "선택하세요",
        "selected_dong": "선택 안 함",
        "birth_year": "",
        "extra_info": "",
        "rename_target_thread_id": None,
        "rename_draft_title": "",
        "thread_id": "",
        "messages": [],
        "last_saved_input_thread_id": "",
        "last_saved_input_state": {},
        "runtime_notice": "",
        "pending_delete_thread_id": None,
        "pending_delete_thread_title": "",
        "pending_clear_current_thread": False,
        "thread_search_query": "",
        "viewport_width": 1200,
        "browser_tab_id": "",
        "browser_tab_thread_id": "",
    }

    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value

    if not isinstance(st.session_state["messages"], list):
        st.session_state["messages"] = []

    if st.session_state.get("browser_tab_thread_id") != browser_tab_thread_id:
        st.session_state["browser_tab_thread_id"] = browser_tab_thread_id

    ensure_runtime_thread_state(show_error=False)
    ensure_valid_active_thread(show_error=False, show_notice=False)


def append_message(role: str, content: str, message_type: str = "") -> bool:
    if not ensure_runtime_thread_state(show_error=False):
        return False

    message = {
        "role": role,
        "content": content,
        "message_type": message_type
    }
    st.session_state["messages"].append(message)
    return True


def format_thread_updated_at(updated_at_text: str) -> str:
    try:
        dt = datetime.strptime(updated_at_text, "%Y-%m-%d %H:%M:%S")
        return dt.strftime("%m-%d %H:%M")
    except Exception:
        return updated_at_text


def build_thread_meta_text(thread: dict) -> str:
    parts = []

    city = thread.get("selected_city", "선택하세요")
    district = thread.get("selected_district", "선택하세요")
    dong = thread.get("selected_dong", "선택 안 함")
    birth_year = thread.get("birth_year", "")
    message_count = thread.get("message_count", 0)
    updated_at = thread.get("updated_at", "")

    if city != "선택하세요" and district != "선택하세요":
        region = f"{city} {district}"
        if dong and dong != "선택 안 함":
            region += f" {dong}"
        parts.append(region)

    if birth_year:
        parts.append(f"{birth_year}년생")

    parts.append(f"메시지 {message_count}개")

    if updated_at:
        parts.append(format_thread_updated_at(updated_at))

    return " · ".join(parts)


def open_rename_editor(thread_id: str, current_title: str):
    st.session_state["rename_target_thread_id"] = thread_id
    st.session_state["rename_draft_title"] = current_title


def show_unsaved_assistant_message(assistant_text: str):
    st.error("AI 응답은 생성되었지만 현재 대화에 저장하지 못했습니다. 아래 내용을 복사해 두신 뒤 다시 시도해 주세요.")
    with st.chat_message("assistant"):
        st.markdown(assistant_text)


def render_thread_item(thread: dict):
    thread_id = thread["thread_id"]
    title = thread["title"] if thread["title"] else "새 대화"
    is_current = thread_id == st.session_state["thread_id"]
    meta_text = html.escape(build_thread_meta_text(thread))
    is_pending_delete = st.session_state.get("pending_delete_thread_id") == thread_id

    with st.container():
        st.markdown('<div class="thread-card">', unsafe_allow_html=True)

        if is_current:
            st.markdown('<div class="thread-badge">현재 대화</div>', unsafe_allow_html=True)

        if st.button(
            title,
            key=f"thread_select_{thread_id}",
            use_container_width=True
        ):
            if not persist_current_inputs(show_error=True):
                return

            if not load_thread_into_session(thread_id):
                st.error("선택한 대화를 불러오지 못했습니다. 다시 시도해 주세요.")
                return

            ensure_valid_active_thread(show_error=False, show_notice=False)
            st.rerun()

        st.markdown(f'<div class="thread-meta">{meta_text}</div>', unsafe_allow_html=True)

        if IS_MOBILE_LAYOUT:
            if st.button(
                "이름 변경",
                key=f"thread_rename_btn_{thread_id}",
                use_container_width=True
            ):
                clear_delete_confirm()
                clear_clear_current_confirm()
                open_rename_editor(thread_id, title)
                st.rerun()

            if st.button(
                "삭제",
                key=f"thread_delete_btn_{thread_id}",
                use_container_width=True
            ):
                clear_rename_state()
                clear_clear_current_confirm()
                open_delete_confirm(thread_id, title)
                st.rerun()
        else:
            action_col1, action_col2 = st.columns(2)

            with action_col1:
                if st.button(
                    "이름 변경",
                    key=f"thread_rename_btn_{thread_id}",
                    use_container_width=True
                ):
                    clear_delete_confirm()
                    clear_clear_current_confirm()
                    open_rename_editor(thread_id, title)
                    st.rerun()

            with action_col2:
                if st.button(
                    "삭제",
                    key=f"thread_delete_btn_{thread_id}",
                    use_container_width=True
                ):
                    clear_rename_state()
                    clear_clear_current_confirm()
                    open_delete_confirm(thread_id, title)
                    st.rerun()

        if st.session_state["rename_target_thread_id"] == thread_id:
            st.markdown('<div class="rename-label">대화 제목 수정</div>', unsafe_allow_html=True)

            with st.form(key=f"rename_form_{thread_id}", clear_on_submit=False):
                st.text_input(
                    "대화 제목 수정",
                    key="rename_draft_title",
                    label_visibility="collapsed",
                    placeholder="새 대화 제목을 입력하세요"
                )

                if IS_MOBILE_LAYOUT:
                    save_clicked = st.form_submit_button("저장", use_container_width=True)
                    cancel_clicked = st.form_submit_button("취소", use_container_width=True)
                else:
                    form_col1, form_col2 = st.columns(2)

                    with form_col1:
                        save_clicked = st.form_submit_button("저장", use_container_width=True)

                    with form_col2:
                        cancel_clicked = st.form_submit_button("취소", use_container_width=True)

            if save_clicked:
                api_rename_thread(
                    st.session_state["browser_user_id"],
                    thread_id,
                    st.session_state["rename_draft_title"]
                )
                clear_rename_state()
                recover_active_thread_state(show_message=False)
                ensure_valid_active_thread(show_error=False, show_notice=False)
                st.rerun()

            if cancel_clicked:
                clear_rename_state()
                st.rerun()

        if is_pending_delete:
            st.markdown(
                f"""
                <div class="delete-confirm-card">
                    <div class="delete-confirm-title">정말 이 대화를 삭제할까요?</div>
                    <div class="delete-confirm-desc">
                        삭제 대상: {html.escape(st.session_state.get("pending_delete_thread_title", "새 대화"))}<br>
                        삭제하면 이 대화의 메시지와 입력값이 함께 제거됩니다.
                    </div>
                </div>
                """,
                unsafe_allow_html=True
            )

            if IS_MOBILE_LAYOUT:
                if st.button(
                    "삭제 확인",
                    key=f"thread_delete_confirm_{thread_id}",
                    use_container_width=True
                ):
                    if not delete_thread_with_confirm(thread_id):
                        st.error("대화를 삭제하지 못했습니다. 다시 시도해 주세요.")
                        return

                    ensure_valid_active_thread(show_error=False, show_notice=False)
                    st.rerun()

                if st.button(
                    "취소",
                    key=f"thread_delete_cancel_{thread_id}",
                    use_container_width=True
                ):
                    clear_delete_confirm()
                    st.rerun()
            else:
                confirm_col1, confirm_col2 = st.columns(2)

                with confirm_col1:
                    if st.button(
                        "삭제 확인",
                        key=f"thread_delete_confirm_{thread_id}",
                        use_container_width=True
                    ):
                        if not delete_thread_with_confirm(thread_id):
                            st.error("대화를 삭제하지 못했습니다. 다시 시도해 주세요.")
                            return

                        ensure_valid_active_thread(show_error=False, show_notice=False)
                        st.rerun()

                with confirm_col2:
                    if st.button(
                        "취소",
                        key=f"thread_delete_cancel_{thread_id}",
                        use_container_width=True
                    ):
                        clear_delete_confirm()
                        st.rerun()

        st.markdown('<div class="thread-divider"></div>', unsafe_allow_html=True)
        st.markdown('</div>', unsafe_allow_html=True)


def render_thread_section(title: str, threads: list):
    if not threads:
        return

    st.markdown(f'<div class="thread-section-title">{html.escape(title)}</div>', unsafe_allow_html=True)

    for thread in threads:
        render_thread_item(thread)


def render_thread_list(threads: list):
    grouped = group_threads_by_recency(threads)

    render_thread_section("오늘", grouped["오늘"])
    render_thread_section("최근 7일", grouped["최근 7일"])

    older_threads = grouped["이전 대화"]
    if older_threads:
        with st.expander("이전 대화 보기"):
            for thread in older_threads:
                render_thread_item(thread)


@st.cache_data
def get_region_data():
    return load_legal_dong_data()


# 💡 [최적화] 사이드바 전체를 Fragment로 감싸기
@st.fragment
def render_sidebar():
    with st.sidebar:
        render_support_sidebar_section()
        st.divider()
        st.title("설정")

        if IS_MOBILE_LAYOUT:
            if st.button("새 대화", use_container_width=True):
                if not persist_current_inputs(show_error=True):
                    st.stop()

                if not create_and_open_new_thread(show_error=True):
                    st.stop()

                clear_clear_current_confirm()
                set_runtime_notice("새 대화를 시작했어요.")
                ensure_valid_active_thread(show_error=False, show_notice=False)
                st.rerun()

            if st.button("대화 비우기", use_container_width=True):
                if not ensure_runtime_thread_state(show_error=True):
                    st.stop()

                clear_delete_confirm()
                clear_rename_state()
                open_clear_current_confirm()
                st.rerun()
        else:
            top_col1, top_col2 = st.columns(2)

            with top_col1:
                if st.button("새 대화", use_container_width=True):
                    if not persist_current_inputs(show_error=True):
                        st.stop()

                    if not create_and_open_new_thread(show_error=True):
                        st.stop()

                    clear_clear_current_confirm()
                    set_runtime_notice("새 대화를 시작했어요.")
                    ensure_valid_active_thread(show_error=False, show_notice=False)
                    st.rerun()

            with top_col2:
                if st.button("대화 비우기", use_container_width=True):
                    if not ensure_runtime_thread_state(show_error=True):
                        st.stop()

                    clear_delete_confirm()
                    clear_rename_state()
                    open_clear_current_confirm()
                    st.rerun()

        if st.session_state.get("pending_clear_current_thread", False):
            current_title = get_current_thread_title()

            st.markdown(
                f"""
                <div class="delete-confirm-card">
                    <div class="delete-confirm-title">현재 대화를 비울까요?</div>
                    <div class="delete-confirm-desc">
                        대상: {html.escape(current_title)}<br>
                        현재 대화의 메시지와 입력값이 삭제되고, 새 대화가 바로 생성됩니다.
                    </div>
                </div>
                """,
                unsafe_allow_html=True
            )

            if IS_MOBILE_LAYOUT:
                if st.button("비우기 확인", key="clear_current_confirm", use_container_width=True):
                    if not ensure_runtime_thread_state(show_error=True):
                        st.stop()

                    api_delete_thread(
                        st.session_state["browser_user_id"],
                        st.session_state["thread_id"]
                    )

                    if not create_and_open_new_thread(show_error=True):
                        st.stop()

                    clear_clear_current_confirm()
                    set_runtime_notice("현재 대화를 비우고 새 대화를 준비했어요.")
                    ensure_valid_active_thread(show_error=False, show_notice=False)
                    st.rerun()

                if st.button("취소", key="clear_current_cancel", use_container_width=True):
                    clear_clear_current_confirm()
                    st.rerun()
            else:
                clear_col1, clear_col2 = st.columns(2)

                with clear_col1:
                    if st.button("비우기 확인", key="clear_current_confirm", use_container_width=True):
                        if not ensure_runtime_thread_state(show_error=True):
                            st.stop()

                        api_delete_thread(
                            st.session_state["browser_user_id"],
                            st.session_state["thread_id"]
                        )

                        if not create_and_open_new_thread(show_error=True):
                            st.stop()

                        clear_clear_current_confirm()
                        set_runtime_notice("현재 대화를 비우고 새 대화를 준비했어요.")
                        ensure_valid_active_thread(show_error=False, show_notice=False)
                        st.rerun()

                with clear_col2:
                    if st.button("취소", key="clear_current_cancel", use_container_width=True):
                        clear_clear_current_confirm()
                        st.rerun()

        st.divider()
        st.subheader("대화 목록")

        st.text_input(
            "대화 검색",
            key="thread_search_query",
            placeholder="제목, 지역, 출생연도로 검색"
        )

        ensure_valid_active_thread(show_error=False, show_notice=False)
        threads = api_list_threads(st.session_state["browser_user_id"])
        filtered_threads = filter_threads_by_query(threads, st.session_state["thread_search_query"])

        if st.session_state["thread_search_query"].strip():
            st.caption(f"검색 결과 {len(filtered_threads)}개")

        if not threads:
            st.caption("저장된 대화가 없습니다.")
        elif not filtered_threads:
            st.caption("검색 조건에 맞는 대화가 없습니다.")
        else:
            render_thread_list(filtered_threads)

        st.divider()
        st.caption("같은 브라우저는 같은 익명 사용자로 인식됩니다.")


# 💡 [최적화] 입력 폼 전체를 Fragment로 감싸기
@st.fragment
def render_input_form(CITY_TO_DISTRICTS, DONG_MAP):
    with st.expander("검색 조건 입력 영역", expanded=len(st.session_state["messages"]) == 0):
        st.subheader("📍 거주지 및 사용자 정보 입력")
        if IS_MOBILE_LAYOUT:
            st.caption("모바일에서는 입력칸을 세로로 배치해 더 편하게 입력할 수 있어요.")

        city_options = ["선택하세요"] + sorted(list(CITY_TO_DISTRICTS.keys()))

        if IS_MOBILE_LAYOUT:
            st.selectbox(
                "시/도",
                city_options,
                key="selected_city",
                on_change=reset_district_and_dong
            )
        else:
            col1, col2, col3 = st.columns(3)

            with col1:
                st.selectbox(
                    "시/도",
                    city_options,
                    key="selected_city",
                    on_change=reset_district_and_dong
                )

        district_options = ["선택하세요"]
        selected_city = st.session_state["selected_city"]

        if selected_city != "선택하세요" and selected_city in CITY_TO_DISTRICTS:
            district_options += CITY_TO_DISTRICTS[selected_city]

        if st.session_state["selected_district"] not in district_options:
            st.session_state["selected_district"] = "선택하세요"

        if IS_MOBILE_LAYOUT:
            st.selectbox(
                "시/군/구",
                district_options,
                key="selected_district",
                on_change=reset_dong
            )
        else:
            with col2:
                st.selectbox(
                    "시/군/구",
                    district_options,
                    key="selected_district",
                    on_change=reset_dong
                )

        dong_options = ["선택 안 함"]
        selected_district = st.session_state["selected_district"]

        if (
            selected_city != "선택하세요"
            and selected_district != "선택하세요"
            and (selected_city, selected_district) in DONG_MAP
        ):
            dong_options += DONG_MAP[(selected_city, selected_district)]

        if st.session_state["selected_dong"] not in dong_options:
            st.session_state["selected_dong"] = "선택 안 함"

        if IS_MOBILE_LAYOUT:
            st.selectbox(
                "법정동 (선택)",
                dong_options,
                key="selected_dong"
            )
        else:
            with col3:
                st.selectbox(
                    "법정동 (선택)",
                    dong_options,
                    key="selected_dong"
                )

        st.text_input(
            "출생연도 (4자리 숫자만 입력)",
            placeholder="예: 1999",
            max_chars=4,
            key="birth_year"
        )

        st.text_area(
            "추가 정보",
            placeholder="예: 대학생, 1인가구, 취업 준비 중",
            height=100,
            key="extra_info"
        )

        persist_current_inputs()

        birth_year = st.session_state["birth_year"].strip()
        extra_info = st.session_state["extra_info"].strip()

        birth_year_valid = is_valid_birth_year(birth_year)
        age_expression_found = contains_age_expression(extra_info)

        if birth_year and not birth_year_valid:
            st.error(f"출생연도는 1900~{CURRENT_YEAR} 사이의 4자리 숫자로 입력해 주세요.")

        if age_expression_found:
            st.error("추가 정보에는 '28세', '28살' 같은 나이 표현을 쓰지 말고, 출생연도는 위 입력칸에만 적어 주세요.")

        region_preview = "미선택"
        if selected_city != "선택하세요" and selected_district != "선택하세요":
            region_preview = build_region_text(
                selected_city,
                selected_district,
                st.session_state["selected_dong"]
            )

        birth_year_preview = birth_year if birth_year else "미입력"

        render_preview_card(region_preview, birth_year_preview, extra_info)

        search_ready = (
            selected_city != "선택하세요"
            and selected_district != "선택하세요"
            and birth_year_valid
            and extra_info != ""
            and not age_expression_found
        )

        if st.button("🔍 맞춤 혜택 찾기", disabled=not search_ready):
            if not persist_current_inputs(show_error=True, force=True):
                return

            if not ensure_valid_active_thread(show_error=True, show_notice=False):
                return

            clear_delete_confirm()

            # 메인 영역에 전체 새로고침(rerun)을 지시하는 신호 전달
            st.session_state["trigger_search"] = True
            st.rerun()


# --------------------------------------------------
# 앱 실행 시작
# --------------------------------------------------
init_app_session()
VIEWPORT_WIDTH = get_viewport_width()
IS_MOBILE_LAYOUT = VIEWPORT_WIDTH <= MOBILE_LAYOUT_BREAKPOINT
inject_custom_css()
inject_auto_scroll()  # 🌟 자동 스크롤 함수 실행 추가!

try:
    CITY_TO_DISTRICTS, DONG_MAP = get_region_data()
except Exception as e:
    CITY_TO_DISTRICTS, DONG_MAP = {}, {}
    st.error(f"법정동 데이터 로딩 오류: {e}")

# 사이드바 렌더링
render_sidebar()

st.title("💵 전국민 맞춤형 정책 내비게이터")
st.markdown(
    "거주지는 아래에서 선택하고, **출생연도는 별도 입력**한 뒤, "
    "**직업 · 가구 형태 · 주거 상태** 등 나머지 정보만 입력해 주세요."
)
st.caption("출생연도 예: 1999 / 추가 정보 예: 대학생, 1인가구, 취업 준비 중")

runtime_notice = pop_runtime_notice()
if runtime_notice:
    render_notice_card(runtime_notice, variant="info", title="상태 안내", expanded=True)

render_notice_card(
    "현재 서비스는 익명 사용자 기준으로 대화를 분리 저장합니다.\n\n"
    "같은 브라우저에서는 새로고침 후에도 대화가 유지되며, 사이드바에서 이전 대화를 다시 열 수 있습니다.",
    variant="info",
    title="저장 및 대화 유지 안내"
)

render_notice_card(
    "이름, 전화번호, 상세 주소 등 불필요한 개인정보는 입력하지 마세요. "
    "나이는 '28세', '28살'처럼 적지 말고 출생연도를 입력해 주세요.",
    variant="caution",
    title="개인정보 입력 주의"
)

render_examples_box()

# 입력 폼 렌더링
render_input_form(CITY_TO_DISTRICTS, DONG_MAP)

# --------------------------------------------------
# 대화 출력 로직
# --------------------------------------------------
if st.session_state["messages"]:
    st.subheader("💬 대화 및 검색 결과")

for i, msg in enumerate(st.session_state["messages"]):
    role = msg.get("role", "")
    content = msg.get("content", "")
    message_type = msg.get("message_type", "")

    with st.chat_message(role):
        if role == "user":
            label_text, label_type = get_user_message_label(message_type)
            if label_text:
                render_message_label(label_text, label_type=label_type)
            st.markdown(content)
            
            
        elif role == "assistant":
            summary_text = get_summary_download_text(content)
            has_summary = bool(summary_text)
            download_base_name = build_download_base_name(i)
            
            # 🌟 [신규 추가] 마크다운 깨짐 방지 패치!
            # 요약 표가 없다면(=중간에 끊겼다면) 강제로 줄바꿈을 추가해 열려있는 표/리스트 블록을 닫아줌
            display_content = content
            if not has_summary:
                display_content += "\n\n"

            render_assistant_result_header(message_type, has_summary)
            
            # 원래 st.markdown(content) 였던 부분을 display_content로 변경!
            st.markdown(display_content) 
            st.divider()
            
            if has_summary:
                if IS_MOBILE_LAYOUT:
                    st.download_button(
                        label="📄 전체 응답 다운로드 (.md)",
                        data=content,
                        file_name=f"{download_base_name}_전체.md",
                        mime="text/markdown",
                        key=f"dl_all_{i}"
                    )
                    st.download_button(
                        label="📊 핵심 요약 표 다운로드 (.md)",
                        data=summary_text,
                        file_name=f"{download_base_name}_요약표.md",
                        mime="text/markdown",
                        key=f"dl_sum_{i}"
                    )
                else:
                    col1, col2 = st.columns(2)
                    with col1:
                        st.download_button(
                            label="📄 전체 응답 다운로드 (.md)",
                            data=content,
                            file_name=f"{download_base_name}_전체.md",
                            mime="text/markdown",
                            key=f"dl_all_{i}"
                        )
                    with col2:
                        st.download_button(
                            label="📊 핵심 요약 표 다운로드 (.md)",
                            data=summary_text,
                            file_name=f"{download_base_name}_요약표.md",
                            mime="text/markdown",
                            key=f"dl_sum_{i}"
                        )
            else:
                st.download_button(
                    label="📄 전체 응답 다운로드 (.md)",
                    data=content,
                    file_name=f"{download_base_name}_전체.md",
                    mime="text/markdown",
                    key=f"dl_all_{i}"
                )
                st.markdown(
                    '<div class="download-caption">이번 응답에서는 추출 가능한 요약 표가 없어 전체 응답만 다운로드할 수 있습니다.</div>',
                    unsafe_allow_html=True
                )

# 🌟 [신규 추가] 답변 이어보기 버튼 로직
if st.session_state["messages"]:
    last_msg = st.session_state["messages"][-1]
    if last_msg.get("role") == "assistant":
        # 요약 표가 정상적으로 추출되지 않았다면(중간에 끊겼다면) 버튼 표시
        if not extract_summary_table(last_msg.get("content", "")):
            st.markdown("<br>", unsafe_allow_html=True)
            st.info("💡 답변이 중간에 끊긴 것 같나요? 아래 버튼을 눌러 마저 들을 수 있어요!")

            if st.button("🔄 답변 이어서 생성하기", use_container_width=True):
                continue_prompt = "답변이 끊겼어. 방금 하던 말부터 이어서 계속해줘."
                
                if not persist_current_inputs(show_error=True, force=True):
                    st.stop()
                if not ensure_valid_active_thread(show_error=True, show_notice=False):
                    st.stop()
                    
                clear_delete_confirm()
                append_message("user", continue_prompt, "followup_question")
                
                with st.chat_message("user"):
                    label_text, label_type = get_user_message_label("followup_question")
                    if label_text:
                        render_message_label(label_text, label_type=label_type)
                    st.markdown(continue_prompt)

                try:
                    with st.chat_message("assistant"):
                        render_assistant_result_header("followup_answer", has_summary=False)
                        stream_generator = api_get_ai_response_stream(
                            user_id=st.session_state["browser_user_id"],
                            thread_id=st.session_state["thread_id"],
                            city=st.session_state["selected_city"],
                            district=st.session_state["selected_district"],
                            dong=st.session_state["selected_dong"],
                            birth_year=st.session_state["birth_year"],
                            extra_info=st.session_state["extra_info"],
                            query=continue_prompt
                        )
                        assistant_text = st.write_stream(stream_generator)

                    append_message("assistant", assistant_text, "followup_answer")
                    ensure_valid_active_thread(show_error=False, show_notice=False)
                    st.rerun()
                except Exception as e:
                    st.error(f"오류 발생: {e}")

# --------------------------------------------------
# 🚀 AI 검색 로직 (스트리밍 완벽 적용)
# --------------------------------------------------
if st.session_state.get("trigger_search", False):
    st.session_state["trigger_search"] = False
    
    region_text = build_region_text(
        st.session_state["selected_city"],
        st.session_state["selected_district"],
        st.session_state["selected_dong"]
    )

    user_display_text = build_user_display_text(
        region_text,
        st.session_state["birth_year"],
        st.session_state["extra_info"]
    )

    # 유저 메시지 화면에 바로 추가
    append_message("user", user_display_text, "structured_search")
    
    with st.chat_message("user"):
        label_text, label_type = get_user_message_label("structured_search")
        if label_text:
            render_message_label(label_text, label_type=label_type)
        st.markdown(user_display_text)

    try:
        # 🌟 여기서부터 스트리밍 시작!
        with st.chat_message("assistant"):
            # 👇 스트리밍 시작 전 헤더를 먼저 렌더링하도록 추가!
            render_assistant_result_header("search_result", has_summary=False)

            stream_generator = api_get_ai_response_stream(
                user_id=st.session_state["browser_user_id"],
                thread_id=st.session_state["thread_id"],
                city=st.session_state["selected_city"],
                district=st.session_state["selected_district"],
                dong=st.session_state["selected_dong"],
                birth_year=st.session_state["birth_year"],
                extra_info=st.session_state["extra_info"]
            )
            
            # 🌟 st.write_stream이 제너레이터를 받아서 타자 치듯 화면에 뿌려줌
            assistant_text = st.write_stream(stream_generator)

        # 다 끝나면 세션에 저장
        append_message("assistant", assistant_text, "search_result")
        ensure_valid_active_thread(show_error=False, show_notice=False)
        st.rerun()

    except Exception as e:
        st.error(f"클라우드 통신 오류: {e}")

# --------------------------------------------------
# 추가 질문 입력창 (스트리밍 적용)
# --------------------------------------------------
followup_disabled = len(st.session_state["messages"]) == 0

if followup_disabled:
    st.markdown(
        '<div class="helper-caption">먼저 위에서 맞춤 혜택 찾기를 실행하면, 아래 입력창으로 추가 질문을 이어서 할 수 있습니다.</div>',
        unsafe_allow_html=True
    )

followup_prompt = st.chat_input(
    "추가 질문을 입력하세요. 예: 월세 지원만 다시 정리해줘 / 지금 바로 신청 가능한 것만 추려줘",
    disabled=followup_disabled
)

if followup_prompt:
    if not persist_current_inputs(show_error=True, force=True):
        st.stop()

    if not ensure_valid_active_thread(show_error=True, show_notice=False):
        st.stop()

    clear_delete_confirm()
    append_message("user", followup_prompt, "followup_question")
    
    with st.chat_message("user"):
        label_text, label_type = get_user_message_label("followup_question")
        if label_text:
            render_message_label(label_text, label_type=label_type)
        st.markdown(followup_prompt)

    try:
        # 🌟 추가 질문 스트리밍 시작!
        with st.chat_message("assistant"):
            # 👇 스트리밍 시작 전 헤더를 먼저 렌더링하도록 추가!
            render_assistant_result_header("followup_answer", has_summary=False)

            stream_generator = api_get_ai_response_stream(
                user_id=st.session_state["browser_user_id"],
                thread_id=st.session_state["thread_id"],
                city=st.session_state["selected_city"],
                district=st.session_state["selected_district"],
                dong=st.session_state["selected_dong"],
                birth_year=st.session_state["birth_year"],
                extra_info=st.session_state["extra_info"],
                query=followup_prompt
            )
            
            # 🌟 (수정) 이전에 write_stream 이었던 부분을 st.write_stream 으로 안전하게 고쳤어!
            assistant_text = st.write_stream(stream_generator)

        append_message("assistant", assistant_text, "followup_answer")
        ensure_valid_active_thread(show_error=False, show_notice=False)
        st.rerun()

    except Exception as e:
        st.error(f"오류 발생: {e}")
