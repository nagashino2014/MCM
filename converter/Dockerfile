# 문서 변환 서비스 — LibreOffice headless 로 오피스·한글 문서를 PDF 로 만든다.
# OCR 백엔드(~15GB)와 분리한 경량 이미지: 파이썬 의존성은 FastAPI 스택만.
# 빌드 컨텍스트는 repo 루트(다른 이미지와 동일): docker build -f converter/Dockerfile .
#
# 베이스를 python:3.11-slim(Debian bookworm, LO 7.4)에서 ubuntu:24.04(LO 24.2)로 전환(2026-09-01):
# LO 7.4 는 증명서 서식(경력증명서)의 제목/표 판형을 다르게 계산해 페이지가 분리됐다.
# 증명서 발급 산출물은 LO 24.2.7 + H2Orestart v0.7.8 조합으로 실측 검증했다.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
# soffice 가 홈 디렉터리에 프로필을 만들려 하므로 쓰기 가능한 경로를 준다.
ENV HOME=/tmp

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    python3 \
    python3-venv \
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

# default-java 심링크(default-jre-headless 제공) — 자바 버전 갱신에도 경로가 유지된다.
ENV JAVA_HOME=/usr/lib/jvm/default-java

# 한컴 전용 서체(휴먼명조) → 나눔명조 fontconfig 별칭 — 증명서 서식의 명조 렌더 유지.
COPY converter/fonts-hwp-substitute.conf /etc/fonts/conf.d/65-mcm-hwp-fonts.conf
RUN fc-cache -f

# hwpx(한글 2014+) 임포트 필터 — LibreOffice 기본 배포에는 없어 확장으로 넣는다.
# 내려받지 못해도 빌드는 계속한다(그 경우 hwpx 변환만 실패하고 뷰어가 다운로드로 안내).
ARG H2ORESTART_VERSION=v0.7.8
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

# ubuntu 24.04 는 PEP 668 로 시스템 pip 설치를 막는다 — venv 로 격리 설치.
RUN python3 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

COPY converter/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# 바로빌 계산서 인쇄 화면 캡처용 Chromium — ubuntu 의 apt chromium 은 snap 스텁이라 컨테이너에서
# 못 쓴다. ubuntu 24.04 는 playwright 공식 지원 배포판이라 --with-deps 가 정상 동작하므로
# playwright 배포 브라우저를 쓴다(MCM_CHROMIUM_PATH 미설정 → app.py 가 기본 브라우저 사용).
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
RUN playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*

COPY converter/app.py converter/office_convert.py ./

EXPOSE 8080
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
