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


def trim_trailing_incomplete_days(trend_by_keyword, dates, threshold=0.9, max_trim=3):
    """네이버 데이터랩은 요청 종료일을 '어제'로 잡아도 실제로는 최근 1~2일치
    집계가 아직 끝나지 않아 응답에서 통째로 생략되는 경우가 있다. align_to_range가
    이런 날짜를 검색량 0으로 채우면, 실제로는 정상 검색량이 있는데도 '집계 미완료'가
    '검색량 0'으로 둔갑해 changeRate가 전 키워드 -100%로 왜곡된다.

    맨 뒤 날짜부터 검사해서 대부분의 키워드(threshold 이상)가 동시에 0이면
    '집계 미완료'로 판단해 그 날짜를 전체 키워드/날짜 배열에서 제거한다.
    실제 검색량이 우연히 낮은 날(개별 키워드 0)까지 지우지 않도록, 반드시
    '거의 모든 키워드가 동시에 0'인 경우에만 트림하며, 데이터 유실을 방지하기
    위해 최대 max_trim일까지만 자른다.
    """
    dates = list(dates)
    trimmed = 0
    while dates and trimmed < max_trim:
        zero_count = sum(1 for v in trend_by_keyword.values() if v and v[-1] == 0.0)
        ratio = zero_count / len(trend_by_keyword) if trend_by_keyword else 0
        if ratio < threshold:
            break
        for kw in trend_by_keyword:
            trend_by_keyword[kw] = trend_by_keyword[kw][:-1]
        dates = dates[:-1]
        trimmed += 1
    return trend_by_keyword, dates, trimmed


def chunk(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]
