"""fetch_naver_trends.py / fetch_custom_keyword_trends.py 가 공유하는
네이버 데이터랩 검색어트렌드 API 호출 헬퍼."""

import json
import time
from datetime import datetime, timedelta
from urllib import request, error

NAVER_API_URL = "https://openapi.naver.com/v1/datalab/search"
BATCH_SIZE = 5  # 네이버 API: keywordGroups 최대 5개/요청


def call_naver_api(client_id, client_secret, start_date, end_date, keyword_batch, retries=3):
    body = {
        "startDate": start_date,
        "endDate": end_date,
        "timeUnit": "date",
        "keywordGroups": [
            {"groupName": kw, "keywords": [kw]} for kw in keyword_batch
        ],
    }
    payload = json.dumps(body).encode("utf-8")
    req = request.Request(
        NAVER_API_URL,
        data=payload,
        method="POST",
        headers={
            "X-Naver-Client-Id": client_id,
            "X-Naver-Client-Secret": client_secret,
            "Content-Type": "application/json",
        },
    )
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            with request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except error.HTTPError as e:
            last_err = e
            if e.code == 429 and attempt < retries:
                time.sleep(2 * attempt)
                continue
            raise RuntimeError(
                f"네이버 API 오류 {e.code}: {e.read().decode('utf-8', 'ignore')}"
            ) from e
        except error.URLError as e:
            last_err = e
            time.sleep(2 * attempt)
    raise RuntimeError(f"네이버 API 호출 실패: {last_err}")


def all_dates(start_date, end_date):
    start = datetime.fromisoformat(start_date).date()
    end = datetime.fromisoformat(end_date).date()
    out = []
    d = start
    while d <= end:
        out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def align_to_range(data_points, start_date, end_date):
    """네이버 API는 검색량이 극히 낮은 키워드의 경우 일부 날짜를 응답에서
    통째로 생략할 수 있다. 그대로 쓰면 프론트엔드의 날짜 배열과 길이가
    어긋나 그래프가 밀린다. period 값을 기준으로 전체 날짜에 맞춰 재정렬하고,
    응답에 없는 날짜는 검색량 0(=거의 검색되지 않음)으로 채운다."""
    by_period = {p["period"]: round(p["ratio"], 1) for p in data_points}
    return [by_period.get(d, 0.0) for d in all_dates(start_date, end_date)]


def compute_change_rate(values):
    """최신값 vs 7일 전 값 기준 전주 대비 변화율(%)."""
    if len(values) < 8:
        return 0
    latest = values[-1]
    prior = values[-8]
    if prior == 0:
        return 100 if latest > 0 else 0
    return round((latest - prior) / prior * 100)


def chunk(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]
