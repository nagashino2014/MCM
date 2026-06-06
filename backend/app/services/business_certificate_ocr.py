"""사업자등록증 전용 OCR 파이프라인.

정보공개 게시판 검토결과서/연간보고서는 텍스트 레이어가 살아 있는 공식 PDF가
많아 `ieps_field_parser.parse_pdf` 의 텍스트 레이어 추출만으로 충분하다. 반면
사업자등록증 사본은 하드카피를 스캔한 저화질 이미지 PDF 가 대부분이라 텍스트
레이어가 없고, 기본 OCR 엔진(PaddleOCR)은 컨테이너에 paddlepaddle 프레임워크가
설치돼 있지 않아 동작하지 않는다.

이 모듈은 사업자등록증 전용으로 다음을 수행한다.
  1. PDF 페이지를 고DPI 로 렌더링하고, 텍스트 레이어가 있으면 우선 사용.
  2. 저화질 스캔 대비 선명화 전처리(업스케일 → CLAHE → 디노이즈 → 언샤프
     마스크 → Otsu 이진화) 를 적용한 여러 변형 이미지를 생성.
  3. 실제 설치돼 동작하는 Tesseract(kor+eng) 를 1순위로, 다중 PSM 결과 중
     최고 점수를 채택하고, 결과가 빈약하면 EasyOCR → PaddleOCR 로 폴백.

외부에서는 :func:`extract_business_certificate_text` 만 사용한다.
"""
from __future__ import annotations

import io
import os
import re
import time
from typing import List, Optional, Tuple

try:  # PyMuPDF
    import fitz  # type: ignore
except Exception:  # pragma: no cover - 환경에 따라 미설치 가능
    fitz = None  # type: ignore

try:
    import numpy as np  # type: ignore
except Exception:  # pragma: no cover
    np = None  # type: ignore


# 렌더링/전처리 파라미터 — 저화질 스캔 인식률 우선으로 비교적 공격적으로 설정한다.
RENDER_DPI = 400              # 페이지 렌더링 DPI (기본 파이프라인 300 보다 높임)
MIN_UPSCALE_LONG_EDGE = 2200  # 긴 변이 이 값보다 작으면 업스케일
MAX_LONG_EDGE = 3500          # 과도한 메모리/시간 방지를 위한 상한
KOREAN_RE = re.compile(r"[가-힣]")
DIGIT_RE = re.compile(r"\d")
# OCR 품질이 신통치 않다고 보는 임계(이하이면 다음 엔진으로 폴백)
MIN_ACCEPTABLE_SCORE = 12
# 이 정도면 업태/종목/법인등록번호 파싱에 충분한 원문이 확보된 것으로 보고
# 추가 Tesseract PSM/이미지 변형 시도를 생략한다. (ALB/API 타임아웃 방지)
HIGH_CONFIDENCE_SCORE = 120


class BusinessCertificateOcrResult:
    def __init__(
        self,
        text: str,
        method: str,
        quality_score: float,
        page_count: int,
        engines_tried: List[str],
        warning: Optional[str] = None,
    ) -> None:
        self.text = text
        self.method = method
        self.quality_score = quality_score
        self.page_count = page_count
        self.engines_tried = engines_tried
        self.warning = warning


def extract_business_certificate_text(
    pdf_bytes: bytes,
    filename: Optional[str] = None,
) -> BusinessCertificateOcrResult:
    """사업자등록증 PDF 바이트에서 선명화 + 다단계 OCR 로 텍스트를 추출한다."""
    started = time.time()
    engines_tried: List[str] = []

    if fitz is None or np is None:
        return BusinessCertificateOcrResult(
            text="",
            method="none",
            quality_score=0.0,
            page_count=0,
            engines_tried=engines_tried,
            warning="OCR 의존 라이브러리(PyMuPDF/numpy)가 설치되지 않았습니다.",
        )

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        return BusinessCertificateOcrResult(
            text="",
            method="none",
            quality_score=0.0,
            page_count=0,
            engines_tried=engines_tried,
            warning=f"PDF 열기 실패: {exc}",
        )

    page_texts: List[str] = []
    used_methods: set[str] = set()
    try:
        page_count = min(doc.page_count, 1)
        for page_index in range(page_count):
            page = doc.load_page(page_index)

            # 1) 텍스트 레이어 추출. 사업자등록증 스캔본은 텍스트 레이어가 있어도
            #    실제 필드 인식에는 부족한 경우가 많아 OCR을 생략하지 않는다.
            layer_text = ""
            try:
                layer_text = page.get_text("text") or ""
            except Exception:
                layer_text = ""

            # 2) 고DPI 렌더링 후 선명화 OCR.
            gray = _render_page_gray(page)
            if gray is None:
                if layer_text.strip():
                    page_texts.append(layer_text.strip())
                    used_methods.add("text_layer")
                continue

            page_text, method, tried = _ocr_image_multi(gray)
            for t in tried:
                if t not in engines_tried:
                    engines_tried.append(t)
            selected_text, selected_method = _select_page_text(layer_text, page_text, method)
            if selected_text.strip():
                page_texts.append(selected_text.strip())
                used_methods.add(selected_method)
    finally:
        try:
            doc.close()
        except Exception:
            pass

    full_text = "\n".join(t for t in page_texts if t).strip()
    score = _score_text(full_text)
    quality = max(0.0, min(1.0, score / 60.0))
    method = "+".join(sorted(used_methods)) if used_methods else "none"

    warning = None
    if not full_text:
        warning = "OCR 결과가 비어 있습니다. 스캔 화질이 매우 낮을 수 있어 수동 입력이 필요합니다."
    elif score < MIN_ACCEPTABLE_SCORE:
        warning = "자동 추출 결과가 부족합니다. OCR 원문을 참고해 수동 보정해 주세요."

    elapsed_ms = int((time.time() - started) * 1000)
    if elapsed_ms > 0:
        # 디버그 로그(운영 로그에서 처리 시간/엔진 확인용).
        print(
            f"[BIZCERT OCR] file={filename or '-'} pages={len(page_texts)} "
            f"score={score} method={method} engines={engines_tried} {elapsed_ms}ms"
        )

    return BusinessCertificateOcrResult(
        text=full_text,
        method=method,
        quality_score=quality,
        page_count=len(page_texts),
        engines_tried=engines_tried,
        warning=warning,
    )


def _render_page_gray(page) -> Optional["np.ndarray"]:
    """페이지를 고DPI 그레이스케일 numpy 배열로 렌더링."""
    try:
        import cv2  # type: ignore
    except Exception:
        cv2 = None  # type: ignore
    try:
        mat = fitz.Matrix(RENDER_DPI / 72.0, RENDER_DPI / 72.0)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        img_bytes = pix.tobytes("png")
    except Exception as exc:
        print(f"[BIZCERT OCR] render 실패: {exc}")
        return None

    if cv2 is not None:
        arr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
        return img
    # cv2 미설치 폴백: PIL 사용.
    try:
        from PIL import Image  # type: ignore

        img = Image.open(io.BytesIO(img_bytes)).convert("L")
        return np.array(img)
    except Exception:
        return None


def _select_page_text(layer_text: str, ocr_text: str, ocr_method: str) -> Tuple[str, str]:
    """텍스트 레이어와 OCR 결과 중 사업자등록증 필드에 더 유효한 원문을 선택/병합."""
    layer = layer_text.strip()
    ocr = ocr_text.strip()
    if not layer:
        return ocr, ocr_method if ocr else "none"
    if not ocr:
        return layer, "text_layer"

    layer_score = _business_certificate_text_score(layer)
    ocr_score = _business_certificate_text_score(ocr)
    if ocr_score >= layer_score:
        if layer_score > 0 and layer not in ocr:
            return f"{ocr}\n{layer}", f"{ocr_method}+text_layer"
        return ocr, ocr_method
    if ocr_score > 0 and ocr not in layer:
        return f"{layer}\n{ocr}", f"text_layer+{ocr_method}"
    return layer, "text_layer"


def _business_certificate_text_score(text: str) -> int:
    """사업자등록증 필드 라벨/번호 중심 점수. 단순 한글 수보다 필드 추출 적합성을 본다."""
    if not text:
        return 0
    compact = re.sub(r"\s+", "", text)
    score = _score_text(text)
    for label in ("사업자등록번호", "법인명", "상호", "대표자", "사업장소재지", "사업의종류", "업태", "종목", "발급사유"):
        if label in compact:
            score += 80
    if re.search(r"대\s*표\s*자\s*[:：]?\s*[가-힣]{2,4}", text):
        score += 260
    if re.search(r"대\s*표\s*자\s*[:：]?\s*[A-Za-z]{2,}", text):
        score -= 80
    if re.search(r"대\s*표\s*[A-Za-z]\s*[:：]?\s*[A-Za-z]{2,}", text):
        score -= 160
    if "자동차부품" in compact:
        score += 80
    if re.search(r"\d{3}\D{0,3}\d{2}\D{0,3}\d{5}", text):
        score += 120
    if re.search(r"\d{6}\D{0,3}\d{7}", text):
        score += 80
    return score


def _enhance_variants(gray: "np.ndarray") -> List[Tuple[str, "np.ndarray"]]:
    """저화질 스캔 선명화 변형 이미지 목록 생성.

    반환: (라벨, 이미지) 목록. 라벨은 디버그용.
    각 변형은 Tesseract 다중 PSM 으로 시도되며 최고 점수 결과가 채택된다.
    """
    try:
        import cv2  # type: ignore
    except Exception:
        # cv2 가 없으면 원본만 반환.
        return [("raw", gray)]

    variants: List[Tuple[str, "np.ndarray"]] = []

    work = gray

    # 1) 업스케일 — 긴 변이 너무 작으면 보간 확대(작은 글자 인식률 향상).
    h, w = work.shape[:2]
    long_edge = max(h, w)
    if long_edge < MIN_UPSCALE_LONG_EDGE:
        scale = min(3.0, MIN_UPSCALE_LONG_EDGE / float(long_edge))
        work = cv2.resize(work, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    elif long_edge > MAX_LONG_EDGE:
        scale = MAX_LONG_EDGE / float(long_edge)
        work = cv2.resize(work, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)

    # 2) 대비 향상(CLAHE).
    try:
        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
        contrasted = clahe.apply(work)
    except Exception:
        contrasted = work

    # 3) 디노이즈.
    try:
        denoised = cv2.fastNlMeansDenoising(contrasted, None, h=10, templateWindowSize=7, searchWindowSize=21)
    except Exception:
        denoised = contrasted

    # 4) 언샤프 마스크(선명화) — 흐린 스캔의 글자 경계 강조.
    try:
        blurred = cv2.GaussianBlur(denoised, (0, 0), sigmaX=2.0)
        sharpened = cv2.addWeighted(denoised, 1.6, blurred, -0.6, 0)
    except Exception:
        sharpened = denoised
    variants.append(("sharpened", sharpened))

    # 5) Otsu 이진화 — 배경 잡음 제거 후 흑백 텍스트.
    try:
        _, otsu = cv2.threshold(sharpened, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        variants.append(("otsu", otsu))
    except Exception:
        pass

    # 6) 적응형 이진화 — 조명 불균일한 스캔 대비.
    try:
        adaptive = cv2.adaptiveThreshold(
            sharpened, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 11
        )
        variants.append(("adaptive", adaptive))
    except Exception:
        pass

    if not variants:
        variants.append(("raw", gray))
    return variants


def _ocr_image_multi(gray: "np.ndarray") -> Tuple[str, str, List[str]]:
    """선명화 변형 + 다단계 엔진 OCR. (텍스트, 채택 method, 시도 엔진 목록) 반환."""
    engines_tried: List[str] = []
    variants = _enhance_variants(gray)

    # 1순위: Tesseract(kor+eng). 컨테이너에 tesseract-ocr-kor 설치됨.
    best_text = ""
    best_score = -1
    if _tesseract_available():
        engines_tried.append("tesseract")
        for _label, img in variants:
            for psm in (4, 6, 3):
                text = _tesseract_ocr(img, psm)
                s = _business_certificate_text_score(text)
                if s > best_score:
                    best_score = s
                    best_text = text
        if best_score >= MIN_ACCEPTABLE_SCORE:
            return best_text, "tesseract", engines_tried

    # 2순위: EasyOCR(torch 설치됨, 모델은 최초 1회 다운로드).
    easy_text = _easyocr_ocr(variants)
    if easy_text is not None:
        engines_tried.append("easyocr")
        easy_score = _business_certificate_text_score(easy_text)
        if easy_score > best_score:
            best_text, best_score = easy_text, easy_score
        if best_score >= MIN_ACCEPTABLE_SCORE:
            return best_text, "easyocr", engines_tried

    # 3순위: PaddleOCR(설치돼 있으면).
    paddle_text = _paddle_ocr(variants)
    if paddle_text is not None:
        engines_tried.append("paddleocr")
        paddle_score = _business_certificate_text_score(paddle_text)
        if paddle_score > best_score:
            best_text, best_score = paddle_text, paddle_score

    method = "tesseract" if "tesseract" in engines_tried and best_text else (
        engines_tried[-1] if engines_tried else "none"
    )
    return best_text, method, engines_tried


# ----------------------------------------------------------------------------
# 엔진별 헬퍼
# ----------------------------------------------------------------------------

_TESS_AVAILABLE: Optional[bool] = None


def _tesseract_available() -> bool:
    global _TESS_AVAILABLE
    if _TESS_AVAILABLE is not None:
        return _TESS_AVAILABLE
    try:
        import pytesseract  # type: ignore

        pytesseract.get_tesseract_version()
        _TESS_AVAILABLE = True
    except Exception as exc:
        print(f"[BIZCERT OCR] tesseract 사용 불가: {exc}")
        _TESS_AVAILABLE = False
    return _TESS_AVAILABLE


def _tesseract_ocr(img: "np.ndarray", psm: int) -> str:
    try:
        import pytesseract  # type: ignore

        config = f"--oem 1 --psm {psm}"
        return pytesseract.image_to_string(img, lang="kor+eng", config=config) or ""
    except Exception:
        return ""


_EASYOCR_READER = None
_EASYOCR_FAILED = False


def _easyocr_ocr(variants: List[Tuple[str, "np.ndarray"]]) -> Optional[str]:
    global _EASYOCR_READER, _EASYOCR_FAILED
    if _EASYOCR_FAILED:
        return None
    try:
        if _EASYOCR_READER is None:
            import easyocr  # type: ignore

            model_dir = os.getenv("MCM_EASYOCR_MODEL_DIR")
            reader_kwargs = {"gpu": False}
            if model_dir:
                reader_kwargs["model_storage_directory"] = model_dir
                reader_kwargs["download_enabled"] = False
            _EASYOCR_READER = easyocr.Reader(["ko", "en"], **reader_kwargs)
    except Exception as exc:
        print(f"[BIZCERT OCR] easyocr 사용 불가: {exc}")
        _EASYOCR_FAILED = True
        return None

    best = ""
    best_score = -1
    for label, img in _select_ocr_variants(variants, "MCM_EASYOCR_VARIANTS", "sharpened"):
        try:
            input_img = _resize_for_engine(img, "MCM_EASYOCR_MAX_LONG_EDGE", 1800)
            lines = _EASYOCR_READER.readtext(input_img, detail=0, paragraph=True)
            text = "\n".join(lines) if lines else ""
        except Exception as exc:
            print(f"[BIZCERT OCR] easyocr variant={label} 실패: {exc}")
            text = ""
        s = _score_text(text)
        if s > best_score:
            best, best_score = text, s
    return best


_PADDLE_OCR = None
_PADDLE_FAILED = False


def _paddle_ocr(variants: List[Tuple[str, "np.ndarray"]]) -> Optional[str]:
    global _PADDLE_OCR, _PADDLE_FAILED
    if _PADDLE_FAILED:
        return None
    try:
        if _PADDLE_OCR is None:
            from paddleocr import PaddleOCR  # type: ignore

            os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
            ocr_version = os.getenv("MCM_PADDLEOCR_VERSION", "PP-OCRv5").strip()
            init_attempts = []
            if ocr_version:
                init_attempts.append({
                    "lang": "korean",
                    "ocr_version": ocr_version,
                    "use_doc_orientation_classify": False,
                    "use_doc_unwarping": False,
                    "use_textline_orientation": False,
                })
            init_attempts.extend([
                {
                    "lang": "korean",
                    "use_doc_orientation_classify": False,
                    "use_doc_unwarping": False,
                    "use_textline_orientation": False,
                },
                {"use_angle_cls": True, "lang": "korean"},
            ])
            last_exc: Optional[Exception] = None
            for kwargs in init_attempts:
                try:
                    _PADDLE_OCR = PaddleOCR(**kwargs)
                    break
                except Exception as exc:
                    last_exc = exc
            if _PADDLE_OCR is None and last_exc is not None:
                raise last_exc
    except Exception as exc:
        print(f"[BIZCERT OCR] paddleocr 사용 불가: {exc}")
        _PADDLE_FAILED = True
        return None

    best = ""
    best_score = -1
    for label, img in _select_ocr_variants(variants, "MCM_PADDLEOCR_VARIANTS", "sharpened,adaptive"):
        try:
            input_img = _as_paddle_image(img)
            if hasattr(_PADDLE_OCR, "predict"):
                result = _PADDLE_OCR.predict(input_img)
            else:
                result = _PADDLE_OCR.ocr(input_img, cls=True)
            text = "\n".join(_extract_paddle_text_lines(result))
        except Exception as exc:
            print(f"[BIZCERT OCR] paddleocr variant={label} 실패: {exc}")
            text = ""
        s = _score_text(text)
        if s > best_score:
            best, best_score = text, s
    return best


def _as_paddle_image(img: "np.ndarray") -> "np.ndarray":
    try:
        import cv2  # type: ignore

        if len(img.shape) == 2:
            return cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    except Exception:
        pass
    return img


def _resize_for_engine(img: "np.ndarray", env_name: str, default_long_edge: int) -> "np.ndarray":
    try:
        import cv2  # type: ignore

        limit = max(800, int(os.getenv(env_name, str(default_long_edge))))
        h, w = img.shape[:2]
        long_edge = max(h, w)
        if long_edge > limit:
            scale = limit / float(long_edge)
            return cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    except Exception:
        pass
    return img


def _extract_paddle_text_lines(result: object) -> List[str]:
    """Support both PaddleOCR 2.x list output and 3.x PaddleX dict output."""
    lines: List[str] = []

    def add(value: object) -> None:
        text = str(value).strip()
        if text:
            lines.append(text)

    def walk(value: object) -> None:
        if value is None:
            return
        if isinstance(value, dict):
            rec_texts = value.get("rec_texts")
            if isinstance(rec_texts, list):
                for item in rec_texts:
                    add(item)
                return
            for item in value.values():
                walk(item)
            return
        if isinstance(value, tuple):
            if len(value) >= 2 and isinstance(value[1], (list, tuple)) and value[1]:
                add(value[1][0])
                return
            for item in value:
                walk(item)
            return
        if isinstance(value, list):
            for item in value:
                walk(item)

    walk(result)
    return lines


def _select_ocr_variants(
    variants: List[Tuple[str, "np.ndarray"]],
    env_name: str,
    default_value: str,
) -> List[Tuple[str, "np.ndarray"]]:
    preferred = [
        label.strip()
        for label in os.getenv(env_name, default_value).split(",")
        if label.strip()
    ]
    selected = [item for item in variants if str(item[0]) in preferred]
    limit = max(1, int(os.getenv(f"{env_name}_LIMIT", "2")))
    return (selected or variants)[:limit]


def _score_text(text: str) -> int:
    """OCR 결과 품질 점수 — 한글/숫자 유의미 문자 수 기준의 단순 휴리스틱."""
    if not text:
        return 0
    korean = len(KOREAN_RE.findall(text))
    digits = len(DIGIT_RE.findall(text))
    return korean + digits
