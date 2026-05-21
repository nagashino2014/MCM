# 텍스트 추출 백엔드 서비스

PDF, HWP, DOCX 등 문서에서 텍스트를 추출하는 Python FastAPI 기반 백엔드 서비스입니다.

## 기능

- **PDF 텍스트 추출**: PyMuPDF를 사용한 텍스트 레이어 추출 + PaddleOCR 기반 스캔 문서 OCR
- **품질 검증**: 한글 비율, 깨진 문자, 문장 구조 등 다양한 지표로 품질 점수 계산
- **후처리**: OCR 오류 패턴 교정, 공백 정리, 특수문자 정규화
- **배치 처리**: 여러 파일 동시 처리 지원
- **실시간 진행 상황**: SSE(Server-Sent Events)를 통한 실시간 진행 상황 전송

## 설치

### 1. Python 가상환경 생성

```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate

# Linux/Mac
source venv/bin/activate
```

### 2. 의존성 설치

```bash
pip install -r requirements.txt
```

### 3. PaddleOCR 추가 설치 (선택)

PaddleOCR을 사용하려면 추가 설정이 필요할 수 있습니다:

```bash
# Windows에서 PaddlePaddle 설치
pip install paddlepaddle

# GPU 사용 시 (CUDA 필요)
pip install paddlepaddle-gpu
```

## 실행

```bash
# 개발 모드 (자동 리로드)
python run.py

# 또는 uvicorn 직접 실행
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

서버가 시작되면 다음 URL에서 API 문서를 확인할 수 있습니다:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## API 엔드포인트

### 기본

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/` | API 상태 확인 |
| GET | `/health` | 헬스 체크 |
| GET | `/supported-formats` | 지원 파일 형식 목록 |

### 추출

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/extract` | 단일 파일 추출 |
| POST | `/extract/batch` | 배치 파일 추출 |
| POST | `/extract/stream` | 스트리밍 배치 추출 (SSE) |

### 파일 관리

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/files` | 추출 대상 파일 목록 |

### 설정

| Method | Endpoint | 설명 |
|--------|----------|------|
| GET | `/settings` | 현재 설정 조회 |
| PUT | `/settings` | 설정 업데이트 |

## 사용 예시

### 단일 파일 추출

```bash
curl -X POST http://localhost:8000/extract \
  -H "Content-Type: application/json" \
  -d '{"file_path": "C:/path/to/document.pdf"}'
```

### 배치 추출

```bash
curl -X POST http://localhost:8000/extract/batch \
  -H "Content-Type: application/json" \
  -d '{
    "file_paths": [
      "C:/path/to/doc1.pdf",
      "C:/path/to/doc2.pdf"
    ]
  }'
```

## 디렉토리 구조

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI 앱 메인
│   ├── config.py            # 설정 관리
│   ├── extractors/          # 파일 형식별 추출기
│   │   ├── __init__.py
│   │   ├── base.py          # 기본 추출기 클래스
│   │   └── pdf_extractor.py # PDF 추출기
│   ├── services/            # 비즈니스 로직
│   │   ├── __init__.py
│   │   └── extraction_service.py
│   └── validators/          # 품질 검증 (확장용)
│       └── __init__.py
├── requirements.txt
├── run.py                   # 서버 실행 스크립트
└── README.md
```

## 설정

### 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `USE_GPU` | `false` | GPU 사용 여부 (PaddleOCR) |
| `OCR_ENGINE` | `paddleocr` | OCR 엔진 (paddleocr, easyocr, tesseract) |
| `CONCURRENT_FILES` | `3` | 동시 처리 파일 수 |

### 품질 검증 기준

| 점수 | 판정 | 조치 |
|------|------|------|
| 0.85 ~ 1.00 | PASS | 완료 처리 |
| 0.70 ~ 0.84 | REVIEW | 검토 필요 |
| 0.50 ~ 0.69 | LLM_VERIFY | LLM 검증 권장 |
| 0.00 ~ 0.49 | LLM_EXTRACT | LLM 재추출 권장 |

## 문제 해결

### PaddleOCR 설치 오류

Windows에서 PaddleOCR 설치 시 오류가 발생하면:

1. Visual C++ Build Tools 설치
2. `pip install paddlepaddle` 먼저 실행
3. 그 후 `pip install paddleocr` 실행

### 한글 인식 문제

한글 인식률이 낮은 경우:
1. `render_dpi`를 300 이상으로 설정
2. `adaptive_preprocessing` 활성화
3. 이미지 품질 확인

## 라이선스

내부 프로젝트용
