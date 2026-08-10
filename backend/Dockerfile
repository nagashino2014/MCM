FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV DOCKER_ENV=true
ENV PIP_CERT=/etc/ssl/certs/ca-certificates.crt
ENV REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
ENV PIP_TRUSTED_HOST="pypi.org files.pythonhosted.org"
ENV MCM_EASYOCR_MODEL_DIR=/app/ocr-models/easyocr

WORKDIR /app/backend

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    libgl1 \
    libglib2.0-0 \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-kor \
    # 전자결재 첨부 미리보기 — 오피스·한글 문서를 PDF 로 변환(app/services/office_convert.py).
    # 한글이 깨지지 않도록 CJK 폰트를 함께 넣는다. JRE 는 hwpx 필터(H2Orestart) 구동용.
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    default-jre-headless \
    fonts-nanum \
    fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

# hwpx(한글 2014+) 임포트 필터 — LibreOffice 기본 배포에는 없어 확장으로 넣는다.
# 네트워크 사정으로 받지 못해도 빌드는 계속한다(그 경우 hwpx 변환만 실패하고 뷰어가 다운로드로 안내).
ARG H2ORESTART_VERSION=v0.7.1
RUN set -eux; \
    url="https://github.com/ebandal/H2Orestart/releases/download/${H2ORESTART_VERSION}/H2Orestart.oxt"; \
    if curl -fsSL -o /tmp/H2Orestart.oxt "$url"; then \
      unopkg add --shared /tmp/H2Orestart.oxt || echo "H2Orestart 설치 실패 — hwpx 변환은 비활성"; \
      rm -f /tmp/H2Orestart.oxt; \
    else \
      echo "H2Orestart 내려받기 실패 — hwpx 변환은 비활성"; \
    fi

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir \
    --trusted-host pypi.org \
    --trusted-host files.pythonhosted.org \
    --trusted-host download.pytorch.org \
    --trusted-host download-r2.pytorch.org \
    -r requirements.txt

COPY backend ./
COPY data/ksic /app/data/ksic

RUN MCM_ALLOW_INSECURE_OCR_MODEL_DOWNLOAD=1 python scripts/preload_ocr_models.py

EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
