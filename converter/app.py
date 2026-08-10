"""
문서 변환 서비스 (mcm-ieps-staging-converter)

전자결재 첨부서류를 결재자가 브라우저에서 그대로 확인할 수 있도록 PDF 로 변환한다.
OCR 백엔드(15GB, 상시 미가동)와 분리된 경량 서비스 — LibreOffice 만 담는다.

엔드포인트:
  POST /convert/pdf   multipart file → application/pdf
  GET  /health        변환기 설치 여부(배포 확인용)

호출자는 Next.js(app/api/approval/docs/[docId]/attachments/[index]) 하나뿐이고,
VPC 내부 service discovery(converter.local)로만 접근한다.
"""
import asyncio

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

import office_convert

app = FastAPI(title="MCM 문서 변환", version="1.0.0")


@app.get("/health")
async def health():
    return {"status": "healthy", "available": office_convert.is_available(), "soffice": office_convert.soffice_path()}


@app.post("/convert/pdf")
async def convert_pdf(file: UploadFile = File(...)):
    if not office_convert.is_available():
        raise HTTPException(status_code=503, detail="문서 변환기(LibreOffice)가 이 서버에 설치되어 있지 않습니다.")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="빈 파일입니다.")
    try:
        # 변환은 CPU 동기 작업 — 이벤트 루프를 막지 않도록 스레드에서 실행한다.
        pdf = await asyncio.to_thread(office_convert.convert_to_pdf, data, file.filename or "attachment")
    except office_convert.ConvertError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return StreamingResponse(iter([pdf]), media_type="application/pdf")
