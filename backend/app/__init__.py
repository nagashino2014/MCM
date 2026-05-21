# Text Extraction Backend
from pathlib import Path

from dotenv import load_dotenv


# backend/.env 를 패키지 import 시점에 로드한다. uvicorn app.main:app, 테스트,
# 개별 모듈 import 모두 같은 환경변수 설정을 보게 하기 위함이다.
load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)
