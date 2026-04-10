import csv
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
CANDIDATE_CSV_FILES = [
    BASE_DIR / "data" / "legal_dong.csv",
    BASE_DIR / "legal_dong.csv",
    Path("data/legal_dong.csv"),
    Path("legal_dong.csv"),
]


def get_csv_file_path() -> Path:
    for csv_file in CANDIDATE_CSV_FILES:
        if csv_file.exists():
            return csv_file

    raise FileNotFoundError(
        "legal_dong.csv 파일을 찾을 수 없습니다. "
        "data/legal_dong.csv 또는 프로젝트 루트에 파일이 있어야 합니다."
    )


def load_legal_dong_data():
    """
    공식 법정동 CSV를 읽어서
    1) 시/도별 시/군/구 목록
    2) (시/도, 시/군/구)별 법정동 목록
    을 반환합니다.
    """
    csv_file = get_csv_file_path()

    city_to_districts = {}
    dong_map = {}

    with csv_file.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)

        for row in reader:
            city = (row.get("시도명") or "").strip()
            district = (row.get("시군구명") or "").strip()
            dong = (row.get("읍면동명") or "").strip()
            ri = (row.get("리명") or "").strip()
            deleted_at = (row.get("삭제일자") or "").strip()

            # 삭제된 법정동 제외
            if deleted_at:
                continue

            if not city:
                continue

            # 시/군/구가 없는 행은 시/도 대표행이라서 건너뜀
            if not district:
                continue

            city_to_districts.setdefault(city, set()).add(district)

            # 법정동명 조합
            legal_dong_name = ""
            if dong and ri:
                legal_dong_name = f"{dong} {ri}"
            elif dong:
                legal_dong_name = dong
            elif ri:
                legal_dong_name = ri

            if legal_dong_name:
                dong_map.setdefault((city, district), set()).add(legal_dong_name)

    city_to_districts = {
        city: sorted(list(districts))
        for city, districts in city_to_districts.items()
    }

    dong_map = {
        key: sorted(list(dongs))
        for key, dongs in dong_map.items()
    }

    return city_to_districts, dong_map