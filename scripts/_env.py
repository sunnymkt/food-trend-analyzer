"""로컬 실행 편의를 위한 아주 단순한 .env 로더.

GitHub Actions에서는 secrets가 환경변수로 직접 주입되므로 이 파일이 하는 일이 없다.
로컬에서 scripts/fetch_naver_trends.py 등을 실행할 때, 프로젝트 루트의 .env 파일에
NAVER_CLIENT_ID=... 형태로 적어두면 자동으로 읽어 os.environ 에 채워준다.
이미 설정된 환경변수는 덮어쓰지 않는다.
"""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_env_file(path=None):
    env_path = Path(path) if path else ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)
