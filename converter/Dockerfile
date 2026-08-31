# 문서 변환 서비스 — LibreOffice headless 로 오피스·한글 문서를 PDF 로 만든다.
# OCR 백엔드(~15GB)와 분리한 경량 이미지: 파이썬 의존성은 FastAPI 스택만.
# 빌드 컨텍스트는 repo 루트(다른 이미지와 동일): docker build -f converter/Dockerfile .
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
# soffice 가 홈 디렉터리에 프로필을 만들려 하므로 쓰기 가능한 경로를 준다.
ENV HOME=/tmp

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    # hwpx 필터(H2Orestart)는 Java 확장이라 JRE 만으로는 부족하다.
    # libreoffice-java-common 이 없으면 "failed to launch javaldx" 로 hwpx 로드가 실패한다(실측).
    libreoffice-java-common \
    default-jre-headless \
    fonts-nanum \
    fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

ENV JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64

# hwpx(한글 2014+) 임포트 필터 — LibreOffice 기본 배포에는 없어 확장으로 넣는다.
# 내려받지 못해도 빌드는 계속한다(그 경우 hwpx 변환만 실패하고 뷰어가 다운로드로 안내).
ARG H2ORESTART_VERSION=v0.7.1
RUN set -eux; \
    url="https://github.com/ebandal/H2Orestart/releases/download/${H2ORESTART_VERSION}/H2Orestart.oxt"; \
    if curl -fsSL -o /tmp/H2Orestart.oxt "$url"; then \
      # unopkg 는 등록에 성공해도 마무리 단계에서 0 이 아닌 코드를 낼 수 있어(실측) 실패로 보지 않는다.
      # 실제 설치 여부는 아래 unopkg list 로 확인하고, 없으면 빌드를 멈춘다.
      unopkg add --shared /tmp/H2Orestart.oxt || true; \
      unopkg list --shared | grep -q "ebandal.libreoffice.H2Orestart"; \
      rm -f /tmp/H2Orestart.oxt; \
    else \
      echo "H2Orestart 내려받기 실패 — hwpx 변환은 비활성"; \
    fi

COPY converter/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# 바로빌 계산서 인쇄 화면 캡처용 Chromium — playwright 의 --with-deps 는 최신 Debian 에서
# 구식 폰트 패키지명(ttf-unifont 등)을 참조해 실패한다(실측). 시스템 chromium 패키지를 쓰면
# 의존성이 apt 로 전부 해결되고, app.py 가 executable_path 로 이 바이너리를 지정한다.
RUN apt-get update && apt-get install -y --no-install-recommends chromium \
  && rm -rf /var/lib/apt/lists/*
ENV MCM_CHROMIUM_PATH=/usr/bin/chromium

COPY converter/app.py converter/office_convert.py ./

EXPOSE 8080
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
