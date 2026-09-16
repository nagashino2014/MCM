"use client";

// QR 배포 이미지 캔버스 — 실제 출력 크기(스마트폰 1080×1920 / 메일 1600×900)로 그린다.
// 미리보기는 부모가 transform: scale() 로 줄여서 보여주고, 내보내기는 이 DOM 을 그대로 캡처한다.
// 수치는 디자인 핸드오프(design_handoff_survey_qr_notice/README.md)의 확정 시안을 따른다.

import { forwardRef } from "react";
import { NOTICE_CANVAS } from "@/lib/survey/defaults";
import type { NoticeFields, NoticeLayout, NoticeTheme } from "@/lib/survey/types";

const FONT_STACK = 'Inter, "Noto Sans KR", "Pretendard Variable", Pretendard, "Malgun Gothic", system-ui, sans-serif';

interface Props {
  layout: NoticeLayout;
  fields: NoticeFields;
  theme: NoticeTheme;
}

/** 상단 CI 띠 — 검출된 색 개수만큼 가로를 등분한다(1색이면 단색 바). */
function CiBand({ height, colors }: { height: number; colors: string[] }) {
  const list = colors.length > 0 ? colors : ["#111111"];
  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height, display: "flex" }}>
      {list.map((c, i) => (
        <div key={`${c}-${i}`} style={{ flex: 1, background: c }} />
      ))}
    </div>
  );
}

/** 줄바꿈(\n)을 <br> 로 — 편집 폼이 여러 줄 텍스트를 그대로 받는다. */
function MultiLine({ text }: { text: string }) {
  const lines = String(text ?? "").split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {line}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}

export const NoticeCanvas = forwardRef<HTMLDivElement, Props>(function NoticeCanvas({ layout, fields, theme }, ref) {
  const ink = theme.ink ?? "#111111";
  const body = theme.body ?? "#374151";
  const badgeBg = fields.badgeTone === "green" ? "#8CC63F" : "#1EA5E0";
  const badgeFg = fields.badgeTone === "green" ? "#111111" : "#FFFFFF";
  const size = NOTICE_CANVAS[layout];

  if (layout === "mail") {
    return (
      <div
        ref={ref}
        style={{
          position: "relative",
          width: size.width,
          height: size.height,
          background: "#FFFFFF",
          display: "grid",
          gridTemplateColumns: "1fr 560px",
          boxSizing: "border-box",
          overflow: "hidden",
          fontFamily: FONT_STACK,
        }}
      >
        <CiBand height={14} colors={theme.bandColors} />

        {/* minWidth:0 이 없으면 아래 정보 행(nowrap)이 1fr 컬럼을 밀어내 캔버스가 1600px 를 넘는다 */}
        <div style={{ padding: "96px 80px 72px 96px", display: "flex", flexDirection: "column", minWidth: 0, boxSizing: "border-box" }}>
          {fields.logoDataUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={fields.logoDataUrl} alt="" style={{ width: 340, marginLeft: -22, marginTop: -34, objectFit: "contain" }} />
          )}
          <span
            style={{
              alignSelf: "flex-start",
              marginTop: 36,
              padding: "10px 22px",
              borderRadius: 999,
              background: badgeBg,
              color: badgeFg,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: ".02em",
              whiteSpace: "nowrap",
            }}
          >
            {fields.badgeText}
          </span>
          <h1 style={{ margin: "24px 0 0", fontSize: 58, fontWeight: 800, lineHeight: 1.18, letterSpacing: "-.02em", color: ink }}>
            <MultiLine text={fields.title} />
          </h1>
          <p style={{ margin: "28px 0 0", fontSize: 26, fontWeight: 500, lineHeight: 1.55, color: body, maxWidth: 820 }}>
            <MultiLine text={fields.description} />
          </p>

          <div style={{ marginTop: "auto", borderTop: "2px solid #E5E7EB", paddingTop: 28 }}>
            {/* 문구가 길면 한 줄에 다 들어가지 않으므로 줄바꿈을 허용한다(각 항목 안에서는 nowrap 유지) */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "16px 44px", fontSize: 21, whiteSpace: "nowrap" }}>
              <InfoCell label="조사 기간" value={fields.periodText} ink={ink} />
              <InfoCell label="소요 시간" value={fields.durationText} ink={ink} />
              <InfoCell
                label="주관"
                value={[fields.hostMain, fields.hostSub].filter(Boolean).join(" · ")}
                ink={ink}
              />
            </div>
            {fields.hostNote && (
              <div style={{ textAlign: "right", marginTop: 6, fontSize: 15, fontWeight: 500, color: "#6B7280" }}>
                {fields.hostNote}
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            background: "#111111",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 32,
            padding: 60,
          }}
        >
          <div style={{ background: "#FFFFFF", borderRadius: 28, padding: 30 }}>
            {fields.qrDataUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={fields.qrDataUrl} alt="설문 QR" width={380} height={380} style={{ imageRendering: "pixelated", display: "block" }} />
            ) : (
              <QrPlaceholder size={380} />
            )}
          </div>
          <p style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#FFFFFF", textAlign: "center", lineHeight: 1.4 }}>
            <MultiLine text={fields.qrCaption} />
          </p>
        </div>
      </div>
    );
  }

  // 스마트폰 배포용 — 1080×1920
  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        width: size.width,
        height: size.height,
        background: "#FFFFFF",
        display: "flex",
        flexDirection: "column",
        padding: "96px 96px 0",
        // 지정한 1080×1920 이 곧 출력 크기가 되도록 — 패딩이 높이에 더해지면 캡처본이 잘린다.
        boxSizing: "border-box",
        overflow: "hidden",
        fontFamily: FONT_STACK,
      }}
    >
      <CiBand height={18} colors={theme.bandColors} />

      {fields.logoDataUrl && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={fields.logoDataUrl} alt="" style={{ width: 400, marginLeft: -28, marginTop: -48, objectFit: "contain" }} />
      )}
      <span
        style={{
          alignSelf: "flex-start",
          marginTop: 32,
          padding: "14px 28px",
          borderRadius: 999,
          background: badgeBg,
          color: badgeFg,
          fontSize: 30,
          fontWeight: 700,
          letterSpacing: ".02em",
          whiteSpace: "nowrap",
        }}
      >
        {fields.badgeText}
      </span>
      <h1 style={{ margin: "28px 0 0", fontSize: 68, fontWeight: 800, lineHeight: 1.2, letterSpacing: "-.02em", color: ink }}>
        <MultiLine text={fields.title} />
      </h1>
      <p style={{ margin: "32px 0 0", fontSize: 32, fontWeight: 500, lineHeight: 1.5, color: body }}>
        <MultiLine text={fields.description} />
      </p>

      <div
        style={{
          marginTop: "auto",
          paddingTop: 40,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 28,
        }}
      >
        <div style={{ background: "#FFFFFF", border: "6px solid #111111", borderRadius: 36, padding: 32 }}>
          {fields.qrDataUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={fields.qrDataUrl} alt="설문 QR" width={440} height={440} style={{ imageRendering: "pixelated", display: "block" }} />
          ) : (
            <QrPlaceholder size={440} />
          )}
        </div>
        <p style={{ margin: 0, fontSize: 32, fontWeight: 700, color: ink, textAlign: "center", lineHeight: 1.4 }}>
          <MultiLine text={fields.qrCaption} />
        </p>
      </div>

      <div
        style={{
          marginTop: 48,
          marginLeft: -96,
          marginRight: -96,
          background: "#111111",
          color: "#FFFFFF",
          padding: "40px 96px 48px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <BarRow label="조사 기간" value={fields.periodText} />
        <BarRow label="소요 시간" value={fields.durationText} />
        <div style={{ display: "flex", gap: 28, fontSize: 28 }}>
          <span style={{ width: 180, color: "#8CC63F", fontWeight: 700, flexShrink: 0 }}>주관</span>
          <span style={{ flex: 1 }}>{fields.hostMain}</span>
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <span>{fields.hostSub}</span>
            {fields.hostNote && <span style={{ fontSize: 20, fontWeight: 500, color: "#9CA3AF" }}>{fields.hostNote}</span>}
          </span>
        </div>
      </div>
    </div>
  );
});

function BarRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 28, fontSize: 28 }}>
      <span style={{ width: 180, color: "#8CC63F", fontWeight: 700, flexShrink: 0 }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function InfoCell({ label, value, ink }: { label: string; value: string; ink: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 18, fontWeight: 600, color: "#6B7280" }}>{label}</span>
      <span style={{ fontWeight: 700, color: ink }}>{value}</span>
    </div>
  );
}

/** QR 미연결 상태 — 자리와 크기를 그대로 차지해 레이아웃이 흔들리지 않게 한다. */
function QrPlaceholder({ size }: { size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        background: "#F3F4F6",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#9CA3AF",
        fontSize: Math.round(size / 18),
        fontWeight: 600,
        textAlign: "center",
        lineHeight: 1.5,
      }}
    >
      설문 링크를 입력하면
      <br />
      QR이 생성됩니다
    </div>
  );
}
