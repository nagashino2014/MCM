"use client";

// 홈 좌상단 — 날씨/시계 위젯(Soft Glass Ink 핸드오프 1:1 이식).
// 실시간 시계(1s) + 위치(geolocation→역지오코딩, 거부 시 기본 위치) + 날씨(/api/home/weather —
// 기상청 초단기실황 주경로, 키 없거나 실패 시 서버가 Open-Meteo 로 폴백).
// 씬 10종: 기본(맑음·흐림·비·눈) + 시즌(봄·여름휴가·가을·설날·추석·크리스마스).
// 시즌 규칙 — 봄 3~5월·여름휴가 7~8월·가을 10~11월은 '맑음'일 때만(다른 기상은 기본 씬),
// 설·추석은 당일 20일 전~연휴 마지막 날(기상 무관, /api/home/holidays 의 seasons),
// 크리스마스는 12월 내내(기상 무관).
//
// 렌더 구조 — 시안 씬은 400×286 고정 좌표계인데 실제 카드는 폭이 가변이라 3층으로 나눈다:
//  ① 풍경 밴드(바다·모래·언덕·눈밭): preserveAspectRatio="none" 으로 카드 폭에 꽉 채움(가로 스트레치)
//  ② 오브젝트 캔버스(400×286): 통째 scale — 인물·나무·건물이 왜곡되지 않는다
//  ③ 낙하 파티클(꽃잎·낙엽·눈): 카드 전폭에 뿌린다

import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { HOME_HALF_H } from "@/lib/home/widgets";
import "./weather-widget.css";

/** 씬 캔버스 원본 크기 — 시안의 모든 씬 좌표(SVG·absolute 오브젝트)가 이 좌표계 기준이다. */
const SCENE_W = 400;
const SCENE_H = 286;

type BaseKind = "맑음" | "흐림" | "비" | "눈";
type SceneKind = BaseKind | "봄" | "여름휴가" | "가을" | "설날" | "추석" | "크리스마스";

interface HolidaySeason {
  kind: "seol" | "chuseok";
  day: string;
  start: string;
  end: string;
}

interface WeatherData {
  temp: number;
  hi: number;
  lo: number;
  base: BaseKind;
}

interface SceneProps {
  scale: number;
}

// 위치 미허용/실패 시 기본 위치 — 본사(서울 금천구). 권한을 허용하면 실제 좌표로 대체된다.
const DEFAULT_LOC = { lat: 37.4569, lon: 126.8956, label: "서울특별시 금천구" };

/** 씬별 카드 배경/설명 서픽스/배지 톤(시안 WMAP 그대로). */
const SCENE_META: Record<SceneKind, { bg: string; desc?: string; badgeBg: string; badgeFg: string }> = {
  맑음: { bg: "linear-gradient(160deg,rgba(255,228,170,0.55),rgba(190,210,255,0.45) 58%,rgba(255,255,255,0.6))", badgeBg: "", badgeFg: "" },
  흐림: { bg: "linear-gradient(160deg,rgba(206,214,230,0.7),rgba(226,231,242,0.55) 62%,rgba(255,255,255,0.6))", badgeBg: "", badgeFg: "" },
  비: { bg: "linear-gradient(160deg,rgba(168,186,222,0.6),rgba(205,218,240,0.5) 60%,rgba(255,255,255,0.6))", badgeBg: "", badgeFg: "" },
  눈: { bg: "linear-gradient(160deg,rgba(214,224,240,0.75),rgba(235,240,250,0.6) 60%,rgba(255,255,255,0.65))", badgeBg: "", badgeFg: "" },
  설날: { bg: "linear-gradient(160deg,rgba(255,208,190,0.55),rgba(255,236,214,0.5) 56%,rgba(255,255,255,0.65))", desc: "설 연휴 시즌", badgeBg: "rgba(216,75,63,0.14)", badgeFg: "#C4483C" },
  추석: { bg: "linear-gradient(160deg,rgba(198,188,240,0.5),rgba(255,224,196,0.45) 58%,rgba(255,255,255,0.62))", desc: "추석 연휴 시즌", badgeBg: "rgba(142,134,238,0.18)", badgeFg: "#7568D8" },
  크리스마스: { bg: "linear-gradient(160deg,rgba(186,226,212,0.55),rgba(212,226,248,0.5) 58%,rgba(255,255,255,0.65))", desc: "크리스마스 시즌", badgeBg: "rgba(59,175,142,0.18)", badgeFg: "#2E8C71" },
  여름휴가: { bg: "linear-gradient(160deg,rgba(255,236,170,0.5),rgba(150,214,240,0.48) 56%,rgba(188,234,222,0.5))", desc: "여름 휴가철", badgeBg: "rgba(95,182,232,0.22)", badgeFg: "#2E6FA0" },
  봄: { bg: "linear-gradient(160deg,rgba(250,205,218,0.5),rgba(214,236,222,0.45) 58%,rgba(255,255,255,0.62))", desc: "벚꽃 개화", badgeBg: "rgba(240,150,175,0.2)", badgeFg: "#C2557E" },
  가을: { bg: "linear-gradient(160deg,rgba(240,196,150,0.5),rgba(250,226,196,0.45) 58%,rgba(255,255,255,0.62))", desc: "단풍 절정", badgeBg: "rgba(219,123,60,0.18)", badgeFg: "#B05A28" },
};

// ── 낙하 파티클 — 음수 animation-delay 로 시작 즉시 무작위 분포(시안 생성 공식 그대로) ──
const RAINS = Array.from({ length: 10 }, (_, i) => ({
  l: 3 + i * 10, h: 9 + (i % 3) * 4, sp: (1.0 + (i % 4) * 0.14).toFixed(2), d: (i * 0.19 % 1.3).toFixed(2),
}));
const SNOWS = Array.from({ length: 12 }, (_, i) => ({
  l: 2 + i * 8.5, s: 3 + (i % 4), o: (0.55 + (i % 3) * 0.2).toFixed(2), sp: (2.6 + (i % 4) * 0.5).toFixed(1), d: (i * 0.55 % 3.8).toFixed(2),
}));
const PETALS = Array.from({ length: 14 }, (_, i) => ({
  l: 2 + i * 7, s: 6 + (i % 3), s2: 5 + (i % 2) * 2,
  c: ["#F7C7D4", "#F4B7C8", "#F0A9BE"][i % 3],
  sp: (4.4 + (i % 4) * 0.7).toFixed(1), d: (i * 0.62 % 4.9).toFixed(2),
}));
const MAPLES = Array.from({ length: 9 }, (_, i) => ({
  l: 3 + i * 11, c: ["#D45C33", "#E7A14E", "#C94B2E", "#DB7B3C", "#B0432A"][i % 5],
  sp: (4.6 + (i % 4) * 0.6).toFixed(1), d: (i * 0.7 % 4.8).toFixed(2),
}));

const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

/** ② 오브젝트 캔버스 — 400×286 좌표계를 통째로 스케일한다(비왜곡).
 *  bottom: 지면이 있는 풍경 씬(하단 중앙 고정) / topRight: 하늘 씬(구름·해가 우상단 코너 기준). */
function SceneCanvas({ scale, anchor = "bottom", children }: { scale: number; anchor?: "bottom" | "topRight"; children: React.ReactNode }) {
  const pos: React.CSSProperties =
    anchor === "topRight"
      ? { right: 0, top: 0, transform: `scale(${scale})`, transformOrigin: "100% 0%" }
      : { left: "50%", bottom: 0, transform: `translateX(-50%) scale(${scale})`, transformOrigin: "50% 100%" };
  return (
    <div className="absolute pointer-events-none" style={{ width: SCENE_W, height: SCENE_H, ...pos }}>
      {children}
    </div>
  );
}

/** ① 풍경 밴드 — 지면·수면을 카드 폭에 꽉 채운다(가로 스트레치, 세로는 캔버스 스케일과 동기). */
function SceneBand({ scale, vbH, children }: { scale: number; vbH: number; children: React.ReactNode }) {
  return (
    <svg
      className="absolute left-0 bottom-0 w-full pointer-events-none"
      style={{ height: vbH * scale }}
      viewBox={`0 0 ${SCENE_W} ${vbH}`}
      preserveAspectRatio="none"
    >
      {children}
    </svg>
  );
}

/** ③ 눈 파티클 레이어(카드 전폭) — 기본 눈=cdSnow 94px / 설날·크리스마스=cdSnowTall 전체 높이. */
function SnowLayer({ tall, top }: { tall?: boolean; top: React.CSSProperties }) {
  return (
    <span style={{ position: "absolute", overflow: "hidden", display: "block", pointerEvents: "none", ...top }}>
      {SNOWS.map((s, i) => (
        <span
          key={i}
          style={{
            position: "absolute", top: 0, left: `${s.l}%`, width: s.s, height: s.s, borderRadius: 999,
            background: `rgba(255,255,255,${s.o})`, boxShadow: "0 0 5px rgba(170,190,235,0.7)",
            animation: `${tall ? "cdSnowTall" : "cdSnow"} ${s.sp}s linear infinite`, animationDelay: `-${s.d}s`,
          }}
        />
      ))}
    </span>
  );
}

/** 태양(광선 회전 + 코어 펄스) — 맑음/여름휴가 공용. */
function Sun({ ray, core, glow }: { ray: React.CSSProperties; core: React.CSSProperties; glow: React.CSSProperties }) {
  return (
    <>
      <span style={{ position: "absolute", borderRadius: 999, ...glow }} />
      <span style={{ position: "absolute", display: "block", animation: "cdSpin 26s linear infinite", opacity: 0.85, ...ray }}>
        <svg width="100%" height="100%" viewBox="0 0 68 68">
          <g stroke="#F0AC3F" strokeWidth={3.2} strokeLinecap="round">
            <line x1={34} y1={3} x2={34} y2={12} /><line x1={34} y1={56} x2={34} y2={65} />
            <line x1={3} y1={34} x2={12} y2={34} /><line x1={56} y1={34} x2={65} y2={34} />
          </g>
          <g stroke="#F0AC3F" strokeWidth={3.2} strokeLinecap="round" transform="rotate(45 34 34)">
            <line x1={34} y1={3} x2={34} y2={12} /><line x1={34} y1={56} x2={34} y2={65} />
            <line x1={3} y1={34} x2={12} y2={34} /><line x1={56} y1={34} x2={65} y2={34} />
          </g>
        </svg>
      </span>
      <span
        style={{
          position: "absolute", borderRadius: 999, animation: "cdSunPulse 3.8s ease-in-out infinite",
          background: "radial-gradient(circle at 32% 30%,#FFEBB8,#F7B94E 62%,#EE9E2E)", ...core,
        }}
      />
    </>
  );
}

/** 둥근 뭉게구름 — 바닥 캡슐 + 원 1~2개(시안 구조 그대로 좌표만 받는다). */
function Cloud({
  wrap, base, puffs, anim,
}: {
  wrap: React.CSSProperties;
  base: { w: number; h: number; c: string };
  puffs: { b: number; l: number; s: number; c: string }[];
  anim: string;
}) {
  return (
    <span style={{ position: "absolute", ...wrap, animation: anim }}>
      <span style={{ position: "absolute", bottom: 0, left: 0, width: base.w, height: base.h, borderRadius: 999, background: base.c }} />
      {puffs.map((p, i) => (
        <span key={i} style={{ position: "absolute", bottom: p.b, left: p.l, width: p.s, height: p.s, borderRadius: 999, background: p.c }} />
      ))}
    </span>
  );
}

const W_WHITE = "linear-gradient(180deg,#FFFFFF,#EAEFF8)";
const W_WHITE2 = "linear-gradient(180deg,#FFFFFF,#F0F3FA)";

function SunnyScene({ scale }: SceneProps) {
  return (
    <SceneCanvas scale={scale} anchor="topRight">
      <Sun
        glow={{ top: -36, right: -30, width: 210, height: 210, background: "radial-gradient(circle,rgba(255,206,110,0.42),transparent 68%)" }}
        ray={{ top: 10, right: 14, width: 94, height: 94 }}
        core={{ top: 33, right: 37, width: 48, height: 48 }}
      />
      <Cloud
        wrap={{ top: 96, right: 70, width: 100, height: 36, filter: "drop-shadow(0 4px 6px rgba(140,155,200,0.2))" }}
        anim="cdCloudA 9s ease-in-out infinite"
        base={{ w: 100, h: 25, c: W_WHITE }}
        puffs={[{ b: 10, l: 15, s: 34, c: W_WHITE2 }, { b: 10, l: 46, s: 26, c: W_WHITE }]}
      />
      <Cloud
        wrap={{ top: 150, right: 20, width: 74, height: 28, opacity: 0.7, filter: "drop-shadow(0 3px 5px rgba(140,155,200,0.18))" }}
        anim="cdCloudB 12s ease-in-out infinite"
        base={{ w: 74, h: 19, c: W_WHITE }}
        puffs={[{ b: 8, l: 12, s: 25, c: W_WHITE2 }]}
      />
    </SceneCanvas>
  );
}

function CloudyScene({ scale }: SceneProps) {
  return (
    <SceneCanvas scale={scale} anchor="topRight">
      <Cloud
        wrap={{ top: 48, right: 118, width: 108, height: 42, opacity: 0.75 }}
        anim="cdCloudB 11s ease-in-out infinite"
        base={{ w: 108, h: 28, c: "linear-gradient(180deg,#D9E0EE,#C3CDE1)" }}
        puffs={[
          { b: 11, l: 16, s: 38, c: "linear-gradient(180deg,#E2E8F3,#CBD4E6)" },
          { b: 11, l: 50, s: 28, c: "linear-gradient(180deg,#DDE4F0,#C3CDE1)" },
        ]}
      />
      <Cloud
        wrap={{ top: 14, right: 14, width: 136, height: 54, filter: "drop-shadow(0 5px 8px rgba(120,140,190,0.22))" }}
        anim="cdCloudA 8s ease-in-out infinite"
        base={{ w: 136, h: 34, c: "linear-gradient(180deg,#FFFFFF,#E7EDF7)" }}
        puffs={[
          { b: 14, l: 17, s: 48, c: "linear-gradient(180deg,#FFFFFF,#EEF2F9)" },
          { b: 14, l: 60, s: 37, c: "linear-gradient(180deg,#FFFFFF,#E7EDF7)" },
        ]}
      />
      <Cloud
        wrap={{ top: 118, right: 36, width: 96, height: 30, opacity: 0.6 }}
        anim="cdCloudA 13s ease-in-out infinite reverse"
        base={{ w: 96, h: 20, c: "linear-gradient(180deg,#E6EBF5,#D2DAEA)" }}
        puffs={[{ b: 8, l: 14, s: 28, c: "linear-gradient(180deg,#EBEFF7,#D8DFED)" }]}
      />
      <span
        style={{
          position: "absolute", top: 104, right: 150, width: 80, height: 11, borderRadius: 999,
          background: "linear-gradient(90deg,transparent,rgba(190,200,224,0.55),transparent)",
          animation: "cdHaze 6s ease-in-out infinite",
        }}
      />
    </SceneCanvas>
  );
}

function RainScene({ scale }: SceneProps) {
  return (
    <SceneCanvas scale={scale} anchor="topRight">
      <span style={{ position: "absolute", top: 52, right: 8, width: 225, height: 130, overflow: "hidden", display: "block", transform: "rotate(7deg)" }}>
        {RAINS.map((r, i) => (
          <span
            key={i}
            style={{
              position: "absolute", top: 0, left: `${r.l}%`, width: 2, height: r.h, borderRadius: 2,
              background: "linear-gradient(180deg,rgba(90,120,220,0),rgba(90,120,220,0.62))",
              animation: `cdRain ${r.sp}s linear infinite`, animationDelay: `-${r.d}s`,
            }}
          />
        ))}
      </span>
      <Cloud
        wrap={{ top: 38, right: 126, width: 96, height: 34, opacity: 0.8, zIndex: 1 }}
        anim="cdCloudB 10s ease-in-out infinite"
        base={{ w: 96, h: 24, c: "linear-gradient(180deg,#CBD4E6,#AEBBD6)" }}
        puffs={[{ b: 9, l: 14, s: 33, c: "linear-gradient(180deg,#D5DDEC,#B6C2DA)" }]}
      />
      <Cloud
        wrap={{ top: 10, right: 18, width: 128, height: 50, filter: "drop-shadow(0 5px 9px rgba(100,120,175,0.28))", zIndex: 1 }}
        anim="cdCloudA 8s ease-in-out infinite"
        base={{ w: 128, h: 31, c: "linear-gradient(180deg,#F4F7FC,#C9D3E6)" }}
        puffs={[
          { b: 13, l: 16, s: 45, c: "linear-gradient(180deg,#FBFCFE,#D3DCEC)" },
          { b: 13, l: 57, s: 34, c: "linear-gradient(180deg,#F4F7FC,#C9D3E6)" },
        ]}
      />
    </SceneCanvas>
  );
}

function SnowScene({ scale }: SceneProps) {
  return (
    <SceneCanvas scale={scale} anchor="topRight">
      <SnowLayer top={{ top: 52, right: 8, width: 235, height: 130 }} />
      <Cloud
        wrap={{ top: 38, right: 124, width: 92, height: 32, opacity: 0.85, zIndex: 1 }}
        anim="cdCloudB 11s ease-in-out infinite"
        base={{ w: 92, h: 23, c: "linear-gradient(180deg,#F2F5FB,#DCE3F0)" }}
        puffs={[{ b: 8, l: 14, s: 31, c: "linear-gradient(180deg,#F8FAFD,#E2E8F3)" }]}
      />
      <Cloud
        wrap={{ top: 9, right: 20, width: 126, height: 50, filter: "drop-shadow(0 5px 9px rgba(130,150,200,0.24))", zIndex: 1 }}
        anim="cdCloudA 9s ease-in-out infinite"
        base={{ w: 126, h: 31, c: "linear-gradient(180deg,#FFFFFF,#E4EAF5)" }}
        puffs={[
          { b: 13, l: 15, s: 45, c: "linear-gradient(180deg,#FFFFFF,#ECF0F8)" },
          { b: 13, l: 56, s: 34, c: "linear-gradient(180deg,#FFFFFF,#E4EAF5)" },
        ]}
      />
    </SceneCanvas>
  );
}

/** 벚나무/단풍나무 — 봄·가을 공용 구조(줄기 + 원형 캐노피, 색만 다르다). id 로 작은 나무가 재사용. */
function SceneTree({ id, trunk, canopy, twinkle }: {
  id: string;
  trunk: string;
  canopy: { cx: number; cy: number; r: number; f: string }[];
  twinkle: { cx: number; cy: number; r: number; f: string; sp: string; delay?: string }[];
}) {
  return (
    <g id={id}>
      <path
        d="M112 200 C106 154 116 120 98 82 M110 146 C82 126 66 110 58 90 M112 118 C136 100 152 90 162 72 M111 166 C126 157 136 151 146 144"
        stroke={trunk} strokeWidth={8} fill="none" strokeLinecap="round"
      />
      <path d="M76 106 C66 96 60 88 58 78 M144 98 C154 88 158 80 160 72" stroke={trunk} strokeWidth={4} fill="none" strokeLinecap="round" />
      {canopy.map((c, i) => (
        <circle key={i} cx={c.cx} cy={c.cy} r={c.r} fill={c.f} />
      ))}
      {twinkle.map((t, i) => (
        <circle
          key={`t${i}`} cx={t.cx} cy={t.cy} r={t.r} fill={t.f}
          style={{ animation: `cdTwinkle ${t.sp} ease-in-out infinite`, animationDelay: t.delay }}
        />
      ))}
    </g>
  );
}

const SPRING_CANOPY = [
  { cx: 52, cy: 78, r: 17, f: "#F4B7C8" }, { cx: 78, cy: 58, r: 21, f: "#F7C7D4" }, { cx: 108, cy: 46, r: 24, f: "#F4B7C8" },
  { cx: 140, cy: 52, r: 22, f: "#F7C7D4" }, { cx: 164, cy: 68, r: 19, f: "#F4B7C8" }, { cx: 178, cy: 92, r: 16, f: "#F0A9BE" },
  { cx: 96, cy: 74, r: 18, f: "#F0A9BE" }, { cx: 126, cy: 70, r: 19, f: "#F7C7D4" }, { cx: 152, cy: 86, r: 17, f: "#F4B7C8" },
  { cx: 66, cy: 96, r: 15, f: "#F7C7D4" }, { cx: 88, cy: 92, r: 14, f: "#F4B7C8" }, { cx: 118, cy: 88, r: 16, f: "#F0A9BE" },
  { cx: 142, cy: 104, r: 14, f: "#F7C7D4" }, { cx: 168, cy: 114, r: 12, f: "#F0A9BE" }, { cx: 104, cy: 60, r: 15, f: "#F7C7D4" },
  { cx: 58, cy: 60, r: 13, f: "#F4B7C8" }, { cx: 150, cy: 138, r: 13, f: "#F4B7C8" }, { cx: 162, cy: 146, r: 10, f: "#F7C7D4" },
  { cx: 144, cy: 150, r: 9, f: "#F0A9BE" }, { cx: 100, cy: 50, r: 9, f: "#FBDCE5" }, { cx: 134, cy: 58, r: 8, f: "#FBDCE5" },
  { cx: 72, cy: 66, r: 7, f: "#FBDCE5" }, { cx: 158, cy: 76, r: 7, f: "#FBDCE5" }, { cx: 90, cy: 80, r: 6, f: "#FBDCE5" },
];
const SPRING_TWINKLE = [
  { cx: 112, cy: 66, r: 3.2, f: "#EC93AD", sp: "3s" },
  { cx: 146, cy: 72, r: 3.2, f: "#EC93AD", sp: "3.6s", delay: "0.8s" },
  { cx: 74, cy: 82, r: 2.8, f: "#EC93AD", sp: "3.2s", delay: "1.6s" },
  { cx: 170, cy: 96, r: 2.8, f: "#EC93AD", sp: "3.4s", delay: "2.2s" },
];
const AUTUMN_CANOPY = [
  { cx: 52, cy: 78, r: 17, f: "#E7A14E" }, { cx: 78, cy: 58, r: 21, f: "#DB7B3C" }, { cx: 108, cy: 46, r: 24, f: "#D45C33" },
  { cx: 140, cy: 52, r: 22, f: "#DB7B3C" }, { cx: 164, cy: 68, r: 19, f: "#C94B2E" }, { cx: 178, cy: 92, r: 16, f: "#D45C33" },
  { cx: 96, cy: 74, r: 18, f: "#C94B2E" }, { cx: 126, cy: 70, r: 19, f: "#E7A14E" }, { cx: 152, cy: 86, r: 17, f: "#DB7B3C" },
  { cx: 66, cy: 96, r: 15, f: "#D45C33" }, { cx: 88, cy: 92, r: 14, f: "#DB7B3C" }, { cx: 118, cy: 88, r: 16, f: "#C94B2E" },
  { cx: 142, cy: 104, r: 14, f: "#E7A14E" }, { cx: 168, cy: 114, r: 12, f: "#DB7B3C" }, { cx: 104, cy: 60, r: 15, f: "#E7A14E" },
  { cx: 58, cy: 60, r: 13, f: "#DB7B3C" }, { cx: 150, cy: 138, r: 13, f: "#DB7B3C" }, { cx: 162, cy: 146, r: 10, f: "#E7A14E" },
  { cx: 144, cy: 150, r: 9, f: "#C94B2E" }, { cx: 100, cy: 50, r: 9, f: "#F2C48E" }, { cx: 134, cy: 58, r: 8, f: "#F2C48E" },
  { cx: 72, cy: 66, r: 7, f: "#F2C48E" }, { cx: 158, cy: 76, r: 7, f: "#F2C48E" },
];
const AUTUMN_TWINKLE = [
  { cx: 112, cy: 66, r: 3.4, f: "#B0432A", sp: "3.4s" },
  { cx: 146, cy: 72, r: 3.4, f: "#B0432A", sp: "3.8s", delay: "1s" },
  { cx: 74, cy: 82, r: 3, f: "#B0432A", sp: "3.6s", delay: "1.8s" },
];

/** 하늘의 새 2마리 — 봄·가을 공용 오브젝트(스트레치되면 안 되므로 캔버스에 얹는다). */
function SkyBirds() {
  return (
    <svg style={{ position: "absolute", left: 0, bottom: 0 }} width={SCENE_W} height={240} viewBox="0 0 400 240">
      <path d="M66 52 q7 -8 15 0 M92 42 q7 -8 15 0" stroke="#9AA1B8" strokeWidth={2.2} fill="none" strokeLinecap="round" />
    </svg>
  );
}

function SpringScene({ scale }: SceneProps) {
  return (
    <>
      <SceneBand scale={scale} vbH={240}>
        <path d="M0 186 Q100 162 210 178 T400 172 L400 240 L0 240 Z" fill="rgba(172,216,140,0.55)" />
        <path d="M0 208 Q120 196 240 204 T400 200 L400 240 L0 240 Z" fill="rgba(193,229,152,0.85)" />
        <ellipse cx={240} cy={214} rx={5} ry={2.4} fill="rgba(244,183,200,0.85)" />
        <ellipse cx={268} cy={220} rx={4.5} ry={2.2} fill="rgba(240,169,190,0.8)" />
        <ellipse cx={312} cy={216} rx={5} ry={2.4} fill="rgba(247,199,212,0.9)" />
        <ellipse cx={204} cy={218} rx={4} ry={2} fill="rgba(244,183,200,0.7)" />
        <ellipse cx={352} cy={220} rx={5} ry={2.2} fill="rgba(244,183,200,0.8)" />
        <path d="M64 208 q2 -9 6 -11 M76 210 q1 -8 5 -10 M158 206 q2 -9 6 -11 M170 208 q2 -8 5 -10" stroke="#7FB85C" strokeWidth={2.2} fill="none" strokeLinecap="round" />
      </SceneBand>
      <SceneCanvas scale={scale}>
        <SkyBirds />
        <span style={{ position: "absolute", top: 132, right: 116, width: 120, height: 122, transformOrigin: "58% 100%", animation: "cdTreeSway 7.2s ease-in-out infinite", opacity: 0.95 }}>
          <svg width={120} height={122} viewBox="0 0 200 204"><use href="#treeSpring" /></svg>
        </span>
        <span style={{ position: "absolute", top: 74, right: 6, width: 180, height: 184, transformOrigin: "58% 100%", animation: "cdTreeSway 6s ease-in-out infinite" }}>
          <svg width={180} height={184} viewBox="0 0 200 204">
            <SceneTree id="treeSpring" trunk="#8A5A48" canopy={SPRING_CANOPY} twinkle={SPRING_TWINKLE} />
          </svg>
        </span>
        <span style={{ position: "absolute", top: 156, left: 52, width: 20, height: 15, animation: "cdFloat 3.4s ease-in-out infinite" }}>
          <svg width={20} height={15} viewBox="0 0 20 15">
            <ellipse cx={6} cy={7} rx={5.5} ry={5} fill="#E8A0C0" transform="rotate(-18 6 7)" />
            <ellipse cx={14} cy={7} rx={5.5} ry={5} fill="#F0B8D0" transform="rotate(18 14 7)" />
            <rect x={9.2} y={2.5} width={1.8} height={10} rx={0.9} fill="#7A4E62" />
          </svg>
        </span>
      </SceneCanvas>
      <span style={{ position: "absolute", top: 44, left: 0, right: 0, bottom: 0, overflow: "hidden", display: "block", pointerEvents: "none" }}>
        {PETALS.map((pt, i) => (
          <span
            key={i}
            style={{
              position: "absolute", top: 0, left: `${pt.l}%`, width: pt.s, height: pt.s2,
              borderRadius: "60% 40% 55% 45%", background: pt.c,
              animation: `cdPetal ${pt.sp}s ease-in infinite`, animationDelay: `-${pt.d}s`,
            }}
          />
        ))}
      </span>
    </>
  );
}

/** 가을 갈대 — 동일 위상 스웨이(시안 7개, 위치·높이만 다름). */
const REEDS: { top: number; left?: number; right?: number; h: number; soft?: boolean; dark?: boolean; ear: string; side?: "l" | "r" }[] = [
  { top: 194, left: 128, h: 70, ear: "#C9A96E", side: "l" },
  { top: 202, left: 152, h: 62, soft: true, ear: "#D9BC85", side: "r" },
  { top: 192, left: 176, h: 72, dark: true, ear: "#C9A96E" },
  { top: 198, right: 4, h: 66, soft: true, ear: "#D9BC85", side: "l" },
  { top: 200, left: 106, h: 56, soft: true, ear: "#C9A96E" },
  { top: 196, left: 206, h: 60, dark: true, ear: "#D9BC85" },
  { top: 200, right: 34, h: 58, soft: true, ear: "#C9A96E", side: "r" },
];

function AutumnScene({ scale }: SceneProps) {
  return (
    <>
      <SceneBand scale={scale} vbH={240}>
        <path d="M0 186 Q100 162 210 178 T400 172 L400 240 L0 240 Z" fill="rgba(235,205,160,0.42)" />
        <path d="M0 208 Q120 196 240 204 T400 200 L400 240 L0 240 Z" fill="rgba(244,226,196,0.75)" />
        <ellipse cx={238} cy={214} rx={7} ry={3} fill="rgba(212,92,51,0.85)" />
        <ellipse cx={268} cy={220} rx={6} ry={2.8} fill="rgba(231,161,78,0.85)" />
        <ellipse cx={310} cy={216} rx={7} ry={3} fill="rgba(201,75,46,0.85)" />
        <ellipse cx={204} cy={218} rx={6} ry={2.6} fill="rgba(219,123,60,0.75)" />
        <ellipse cx={352} cy={220} rx={6} ry={2.6} fill="rgba(212,92,51,0.7)" />
        <ellipse cx={128} cy={216} rx={5.5} ry={2.4} fill="rgba(231,161,78,0.65)" />
      </SceneBand>
      <SceneCanvas scale={scale}>
        <SkyBirds />
        <span style={{ position: "absolute", top: 132, right: 116, width: 120, height: 122, transformOrigin: "58% 100%", animation: "cdTreeSway 7.5s ease-in-out infinite", opacity: 0.95 }}>
          <svg width={120} height={122} viewBox="0 0 200 204"><use href="#treeAutumn" /></svg>
        </span>
        <span style={{ position: "absolute", top: 74, right: 6, width: 180, height: 184, transformOrigin: "58% 100%", animation: "cdTreeSway 6s ease-in-out infinite" }}>
          <svg width={180} height={184} viewBox="0 0 200 204">
            <SceneTree id="treeAutumn" trunk="#7A5238" canopy={AUTUMN_CANOPY} twinkle={AUTUMN_TWINKLE} />
          </svg>
        </span>
        {REEDS.map((r, i) => (
          <span
            key={i}
            style={{
              position: "absolute", top: r.top, left: r.left, right: r.right, width: 26, height: r.h,
              transformOrigin: "50% 100%", animation: `${r.soft ? "cdReedSoft" : "cdReed"} 3.6s ease-in-out infinite`,
            }}
          >
            <svg width={26} height={r.h} viewBox="0 0 26 70">
              <path d={i % 2 ? "M13 70 Q14 34 12 12" : "M13 70 Q12 34 14 12"} stroke={r.dark ? "#A8834E" : "#B8935A"} strokeWidth={2.5} fill="none" strokeLinecap="round" />
              <ellipse cx={i % 2 ? 12 : 14} cy={12} rx={4.5} ry={11} fill={r.ear} />
              {r.side === "l" && <path d="M13 46 q-8 -4 -11 -12" stroke="#B8935A" strokeWidth={2} fill="none" strokeLinecap="round" />}
              {r.side === "r" && <path d="M13 48 q8 -4 11 -12" stroke="#B8935A" strokeWidth={2} fill="none" strokeLinecap="round" />}
            </svg>
          </span>
        ))}
        <span style={{ position: "absolute", top: 166, left: 52, width: 26, height: 12, animation: "cdGull 6s ease-in-out infinite" }}>
          <svg width={26} height={12} viewBox="0 0 26 12">
            <ellipse cx={8} cy={4} rx={7} ry={2.6} fill="rgba(180,210,235,0.85)" transform="rotate(-14 8 4)" />
            <ellipse cx={8} cy={8} rx={7} ry={2.6} fill="rgba(180,210,235,0.7)" transform="rotate(14 8 8)" />
            <rect x={10} y={5} width={14} height={2} rx={1} fill="#C05A38" />
            <circle cx={10.5} cy={6} r={2.2} fill="#A34A2E" />
          </svg>
        </span>
      </SceneCanvas>
      <span style={{ position: "absolute", top: 44, left: 0, right: 0, bottom: 0, overflow: "hidden", display: "block", pointerEvents: "none" }}>
        {MAPLES.map((lf, i) => (
          <span
            key={i}
            style={{
              position: "absolute", top: 0, left: `${lf.l}%`, width: 14, height: 11,
              borderRadius: "65% 35% 60% 40%", background: lf.c,
              animation: `cdLeafBig ${lf.sp}s ease-in infinite`, animationDelay: `-${lf.d}s`,
            }}
          />
        ))}
      </span>
    </>
  );
}

function SeolScene({ scale }: SceneProps) {
  return (
    <>
      <SceneBand scale={scale} vbH={240}>
        <path d="M0 196 Q110 184 220 192 T400 188 L400 240 L0 240 Z" fill="rgba(248,250,255,0.95)" />
      </SceneBand>
      <SceneCanvas scale={scale}>
        <svg style={{ position: "absolute", left: 0, bottom: 0 }} width={SCENE_W} height={240} viewBox="0 0 400 240">
          <ellipse cx={296} cy={200} rx={86} ry={7} fill="rgba(190,200,225,0.35)" />
          <rect x={236} y={192} width={128} height={8} rx={2} fill="#C9C2B4" />
          <rect x={244} y={152} width={112} height={40} fill="#8A6240" />
          <rect x={247} y={156} width={14} height={32} fill="#E8DFC8" />
          <rect x={339} y={156} width={14} height={32} fill="#E8DFC8" />
          <rect x={267} y={156} width={20} height={36} rx={1.5} fill="#B98A63" />
          <rect x={291} y={156} width={20} height={36} rx={1.5} fill="#B98A63" />
          <rect x={315} y={156} width={20} height={36} rx={1.5} fill="#B98A63" />
          <path d="M273 156 V192 M281 156 V192 M297 156 V192 M305 156 V192 M321 156 V192 M329 156 V192 M267 164 H335 M267 174 H335 M267 184 H335" stroke="#E8DFC8" strokeWidth={1.2} />
          <rect x={263} y={152} width={4} height={40} fill="#6E4A2A" />
          <rect x={287} y={152} width={4} height={40} fill="#6E4A2A" />
          <rect x={311} y={152} width={4} height={40} fill="#6E4A2A" />
          <rect x={335} y={152} width={4} height={40} fill="#6E4A2A" />
          <rect x={228} y={148} width={144} height={5} fill="#6E4A2A" />
          <path d="M256 102 Q300 110 344 102 C362 114 376 128 392 140 Q346 152 300 150 Q254 152 208 140 C224 128 238 114 256 102 Z" fill="#4A4E5C" />
          <path d="M256 93 Q300 101 344 93 L344 103 Q300 111 256 103 Z" fill="#33374A" />
          <rect x={250} y={89} width={12} height={15} rx={2.5} fill="#33374A" />
          <rect x={338} y={89} width={12} height={15} rx={2.5} fill="#33374A" />
          <path d="M268 104 Q256 126 242 141 M284 104 Q278 126 272 147 M300 104 V149 M316 104 Q322 126 328 147 M332 104 Q344 126 358 141" stroke="#3A3E4C" strokeWidth={1.8} fill="none" />
          <path d="M212 139 Q254 149 300 147 Q346 149 388 139" stroke="#DDE2EC" strokeWidth={4} strokeDasharray="0.8 7.4" strokeLinecap="round" fill="none" opacity={0.85} />
          <path d="M254 91 Q300 100 346 91" stroke="#FFFFFF" strokeWidth={5} strokeLinecap="round" fill="none" opacity={0.95} />
          <ellipse cx={256} cy={87} rx={7} ry={2.5} fill="#FFFFFF" opacity={0.95} />
          <ellipse cx={344} cy={87} rx={7} ry={2.5} fill="#FFFFFF" opacity={0.95} />
          <ellipse cx={270} cy={118} rx={11} ry={3} fill="#FFFFFF" opacity={0.9} />
          <ellipse cx={322} cy={124} rx={13} ry={3.5} fill="#FFFFFF" opacity={0.9} />
          <ellipse cx={296} cy={111} rx={8} ry={2.5} fill="#FFFFFF" opacity={0.9} />
          <ellipse cx={238} cy={132} rx={9} ry={2.8} fill="#FFFFFF" opacity={0.85} />
          <ellipse cx={360} cy={130} rx={9} ry={2.8} fill="#FFFFFF" opacity={0.85} />
          <path d="M214 137 Q254 147 300 145 Q346 147 386 137" stroke="#FFFFFF" strokeWidth={4} strokeLinecap="round" fill="none" opacity={0.85} />
          <line x1={242} y1={142} x2={242} y2={152} stroke="#B98A2E" strokeWidth={1.6} />
          <rect x={237} y={152} width={10} height={5} rx={2} fill="#E3A63B" />
          <circle cx={242} cy={163} r={9} fill="#D84B3F" />
          <path d="M96 76 Q130 140 158 172" stroke="rgba(90,95,120,0.4)" strokeWidth={1.4} fill="none" />
          <path d="M153 149 q9 -12 18 0 z" fill="#2F2A33" />
          <circle cx={162} cy={150} r={8.5} fill="#F7D9C4" />
          <path d="M154 145 q8 -8 16 0" stroke="#2F2A33" strokeWidth={4} fill="none" strokeLinecap="round" />
          <polygon points="150,158 174,158 178,172 146,172" fill="#5468C9" />
          <path d="M162 160 v9 M162 164 q5 2 7 5" stroke="#F3E7D3" strokeWidth={1.7} fill="none" strokeLinecap="round" />
          <polygon points="148,172 176,172 184,196 140,196" fill="#D84B3F" />
          <circle cx={196} cy={160} r={6.5} fill="#F7D9C4" />
          <path d="M190 156 q6 -7 12 0" stroke="#2F2A33" strokeWidth={3.4} fill="none" strokeLinecap="round" />
          <polygon points="189,166 203,166 206,180 186,180" fill="#E3A63B" />
          <polygon points="185,180 207,180 210,196 182,196" fill="#5468C9" />
          <ellipse cx={70} cy={200} rx={26} ry={4.5} fill="rgba(200,210,235,0.5)" />
          <circle cx={70} cy={186} r={12} fill="#FFFFFF" stroke="#DCE3F0" strokeWidth={1.4} />
          <circle cx={70} cy={168} r={8.5} fill="#FFFFFF" stroke="#DCE3F0" strokeWidth={1.4} />
          <circle cx={67} cy={166} r={1.3} fill="#2A3040" />
          <circle cx={73} cy={166} r={1.3} fill="#2A3040" />
          <polygon points="70,168 79,170 70,172" fill="#E8813E" />
        </svg>
        <span style={{ position: "absolute", top: 14, left: 78, width: 44, height: 92, animation: "cdKite 5.5s ease-in-out infinite", filter: "drop-shadow(0 4px 6px rgba(160,80,70,0.3))" }}>
          <svg width={44} height={92} viewBox="0 0 48 100">
            <polygon points="24,2 46,28 24,54 2,28" fill="#E85D5D" />
            <path d="M24 2 V54 M2 28 H46" stroke="#FFF3E0" strokeWidth={1.6} />
            <circle cx={24} cy={28} r={6.5} fill="#F2C14E" />
            <path d="M24 54 q12 16 0 30 q-12 14 0 28" stroke="#E85D5D" strokeWidth={2} fill="none" />
            <rect x={18} y={66} width={7} height={4} rx={1} fill="#5468C9" transform="rotate(-18 21 68)" />
            <rect x={24} y={86} width={7} height={4} rx={1} fill="#F2C14E" transform="rotate(14 27 88)" />
          </svg>
        </span>
      </SceneCanvas>
      <SnowLayer tall top={{ top: 8, left: 0, right: 0, bottom: 0 }} />
    </>
  );
}

function ChuseokScene({ scale }: SceneProps) {
  return (
    <>
      <SceneBand scale={scale} vbH={286}>
        <path d="M0 232 Q110 220 220 228 T400 224 L400 286 L0 286 Z" fill="rgba(150,138,185,0.35)" />
      </SceneBand>
      <SceneCanvas scale={scale}>
        <svg style={{ position: "absolute", inset: 0 }} width={SCENE_W} height={SCENE_H} viewBox="0 0 400 286">
          <circle cx={100} cy={98} r={72} fill="rgba(245,206,126,0.28)" />
          <circle cx={100} cy={98} r={54} fill="#FFF3D0" />
          <circle cx={78} cy={84} r={6} fill="rgba(228,186,110,0.42)" />
          <circle cx={118} cy={70} r={4.5} fill="rgba(228,186,110,0.38)" />
          <circle cx={66} cy={112} r={5} fill="rgba(228,186,110,0.38)" />
          <ellipse cx={86} cy={136} rx={15} ry={2.6} fill="rgba(180,150,90,0.3)" />
          <ellipse cx={114} cy={139} rx={12} ry={2.4} fill="rgba(180,150,90,0.3)" />
          {/* 떡방아 토끼 — 몸통 기울임(cdLean)과 수직 절구질(cdPoundV) 2.2s 동기화 */}
          <g style={{ transformBox: "fill-box", transformOrigin: "55% 96%", animation: "cdLean 2.2s ease-in-out infinite" }}>
            <circle cx={74} cy={122} r={4.5} fill="#FFFFFF" />
            <ellipse cx={86} cy={118} rx={12} ry={16} fill="#FBF8F0" stroke="#D8CBA8" strokeWidth={1.2} />
            <ellipse cx={80} cy={133} rx={5.5} ry={3} fill="#FBF8F0" stroke="#D8CBA8" strokeWidth={1} />
            <ellipse cx={93} cy={133} rx={5.5} ry={3} fill="#FBF8F0" stroke="#D8CBA8" strokeWidth={1} />
            <ellipse cx={82} cy={74} rx={4} ry={14} fill="#FBF8F0" stroke="#D8CBA8" strokeWidth={1} transform="rotate(-10 82 74)" />
            <ellipse cx={95} cy={73} rx={4} ry={14} fill="#FBF8F0" stroke="#D8CBA8" strokeWidth={1} transform="rotate(6 95 73)" />
            <ellipse cx={82} cy={76} rx={2} ry={9} fill="#F0BFC6" transform="rotate(-10 82 76)" />
            <ellipse cx={95} cy={75} rx={2} ry={9} fill="#F0BFC6" transform="rotate(6 95 75)" />
            <circle cx={88} cy={94} r={11} fill="#FBF8F0" stroke="#D8CBA8" strokeWidth={1.2} />
            <ellipse cx={87} cy={105} rx={7} ry={6.5} fill="#FBF8F0" />
            <circle cx={93} cy={92} r={1.6} fill="#4A4038" />
            <circle cx={98} cy={96} r={1.3} fill="#E0A0A8" />
            <circle cx={91} cy={99} r={2} fill="rgba(240,170,180,0.5)" />
          </g>
          <path d="M103 106 h22 l-2.5 26 q-0.8 5 -8.5 5 q-7.7 0 -8.5 -5 Z" fill="#8A6240" />
          <path d="M104 116 h20 M105 126 h18" stroke="#6E4A2A" strokeWidth={1.2} />
          <ellipse cx={114} cy={106} rx={11} ry={3} fill="#A97B4F" />
          <ellipse cx={114} cy={105} rx={7} ry={2.2} fill="#FFF8E8" />
          <g style={{ animation: "cdPoundV 2.2s ease-in-out infinite" }}>
            <rect x={111} y={70} width={6} height={34} rx={3} fill="#B98A63" />
            <rect x={108} y={63} width={12} height={11} rx={4} fill="#A97B4F" />
            <path d="M93 108 Q103 102 112 93" stroke="#FBF8F0" strokeWidth={5} fill="none" strokeLinecap="round" />
          </g>
          <path d="M400 20 Q348 34 312 66 M366 38 Q356 56 358 72" stroke="#6E4E3A" strokeWidth={7} fill="none" strokeLinecap="round" />
          <ellipse cx={330} cy={52} rx={14} ry={7} fill="#4F7D5A" transform="rotate(-22 330 52)" />
          <ellipse cx={368} cy={36} rx={12} ry={6} fill="#5A8A64" transform="rotate(-10 368 36)" />
          <ellipse cx={298} cy={62} rx={11} ry={5.5} fill="#4F7D5A" transform="rotate(-30 298 62)" />
          <circle cx={338} cy={84} r={13} fill="#E8813E" />
          <circle cx={306} cy={76} r={11} fill="#E06F2E" />
          <circle cx={372} cy={64} r={10} fill="#E8813E" />
          <path d="M331 74 h14 l-3 4 h-8 Z" fill="#4F7D5A" />
          <path d="M300 67 h12 l-2.5 4 h-7 Z" fill="#4F7D5A" />
          <path d="M366 56 h12 l-2.5 4 h-7 Z" fill="#4F7D5A" />
          <rect x={236} y={224} width={128} height={8} rx={2} fill="#8E8CA0" />
          <rect x={244} y={184} width={112} height={40} fill="#8A6240" />
          <rect x={247} y={188} width={14} height={32} fill="#E8DFC8" />
          <rect x={339} y={188} width={14} height={32} fill="#E8DFC8" />
          <rect x={267} y={188} width={20} height={36} rx={1.5} fill="#F5CE7E" style={{ animation: "cdTwinkle 4s ease-in-out infinite" }} />
          <rect x={291} y={188} width={20} height={36} rx={1.5} fill="#F0C468" />
          <rect x={315} y={188} width={20} height={36} rx={1.5} fill="#F5CE7E" style={{ animation: "cdTwinkle 5s ease-in-out infinite", animationDelay: "1.2s" }} />
          <path d="M273 188 V224 M281 188 V224 M297 188 V224 M305 188 V224 M321 188 V224 M329 188 V224 M267 196 H335 M267 206 H335 M267 216 H335" stroke="#8A6240" strokeWidth={1.2} />
          <rect x={263} y={184} width={4} height={40} fill="#6E4A2A" />
          <rect x={287} y={184} width={4} height={40} fill="#6E4A2A" />
          <rect x={311} y={184} width={4} height={40} fill="#6E4A2A" />
          <rect x={335} y={184} width={4} height={40} fill="#6E4A2A" />
          <rect x={228} y={180} width={144} height={5} fill="#6E4A2A" />
          <path d="M256 134 Q300 142 344 134 C362 146 376 160 392 172 Q346 184 300 182 Q254 184 208 172 C224 160 238 146 256 134 Z" fill="#3A3F52" />
          <path d="M256 125 Q300 133 344 125 L344 135 Q300 143 256 135 Z" fill="#2E3344" />
          <rect x={250} y={121} width={12} height={15} rx={2.5} fill="#2E3344" />
          <rect x={338} y={121} width={12} height={15} rx={2.5} fill="#2E3344" />
          <path d="M268 136 Q256 158 242 173 M284 136 Q278 158 272 179 M300 136 V181 M316 136 Q322 158 328 179 M332 136 Q344 158 358 173" stroke="#2E3344" strokeWidth={1.8} fill="none" />
          <path d="M212 171 Q254 181 300 179 Q346 181 388 171" stroke="#E8E4F0" strokeWidth={4} strokeDasharray="0.8 7.4" strokeLinecap="round" fill="none" opacity={0.85} />
        </svg>
        <span style={{ position: "absolute", top: 150, left: 44, width: 130, height: 26, animation: "cdCloudA 10s ease-in-out infinite" }}>
          <span style={{ position: "absolute", top: 0, left: 0, width: 104, height: 12, borderRadius: 999, background: "rgba(255,255,255,0.75)" }} />
          <span style={{ position: "absolute", top: 13, left: 20, width: 72, height: 10, borderRadius: 999, background: "rgba(255,255,255,0.55)" }} />
        </span>
      </SceneCanvas>
      <span style={{ position: "absolute", top: 36, left: 0, right: 0, bottom: 0, overflow: "hidden", display: "block", pointerEvents: "none" }}>
        {MAPLES.slice(0, 6).map((lf, i) => (
          <span
            key={i}
            style={{
              position: "absolute", top: 0, left: `${lf.l}%`, width: 12, height: 9,
              borderRadius: "65% 35% 60% 40%", background: lf.c,
              animation: `cdLeafBig ${lf.sp}s ease-in infinite`, animationDelay: `-${lf.d}s`,
            }}
          />
        ))}
      </span>
    </>
  );
}

function XmasScene({ scale }: SceneProps) {
  return (
    <>
      <SceneBand scale={scale} vbH={286}>
        <path d="M0 224 Q110 212 220 220 T400 216 L400 286 L0 286 Z" fill="rgba(248,250,255,0.95)" />
      </SceneBand>
      <SceneCanvas scale={scale}>
        <svg style={{ position: "absolute", inset: 0 }} width={SCENE_W} height={SCENE_H} viewBox="0 0 400 286">
          <ellipse cx={104} cy={224} rx={60} ry={7} fill="rgba(190,200,225,0.4)" />
          <rect x={96} y={208} width={15} height={18} rx={3} fill="#8A6240" />
          <polygon points="104,140 164,210 44,210" fill="#2E7052" />
          <polygon points="104,122 152,182 56,182" fill="#357F5F" />
          <polygon points="104,106 142,156 66,156" fill="#3E8F6C" />
          <polygon points="104,94 130,136 78,136" fill="#47A078" />
          <path d="M50 208 Q104 197 158 208" stroke="#F4F8FF" strokeWidth={5} fill="none" strokeLinecap="round" opacity={0.85} />
          <path d="M62 180 Q104 171 146 180" stroke="#F4F8FF" strokeWidth={4} fill="none" strokeLinecap="round" opacity={0.85} />
          <path d="M72 154 Q104 147 136 154" stroke="#F4F8FF" strokeWidth={3.5} fill="none" strokeLinecap="round" opacity={0.85} />
          <path d="M66 194 Q104 208 142 194" stroke="#E8C05A" strokeWidth={3} fill="none" />
          <path d="M77 166 Q104 177 131 166" stroke="#E8C05A" strokeWidth={2.5} fill="none" />
          <circle cx={82} cy={192} r={4.4} fill="#E85D5D" style={{ animation: "cdTwinkle 1.8s ease-in-out infinite" }} />
          <circle cx={130} cy={190} r={4.4} fill="#5FB6E8" style={{ animation: "cdTwinkle 2.2s ease-in-out infinite", animationDelay: "0.5s" }} />
          <circle cx={90} cy={160} r={4} fill="#F2C14E" style={{ animation: "cdTwinkle 2s ease-in-out infinite", animationDelay: "1s" }} />
          <circle cx={122} cy={158} r={4} fill="#E85D5D" style={{ animation: "cdTwinkle 2.4s ease-in-out infinite", animationDelay: "0.3s" }} />
          <circle cx={104} cy={130} r={3.8} fill="#5FB6E8" style={{ animation: "cdTwinkle 2.1s ease-in-out infinite", animationDelay: "0.9s" }} />
          <polygon points="104,66 107.5,76 117,76 109.5,82 112.5,92 104,86 95.5,92 98.5,82 90,76 100.5,76" fill="#F2C14E" style={{ animation: "cdTwinkle 2s ease-in-out infinite" }} />
          <rect x={40} y={208} width={28} height={20} rx={3} fill="#D84B3F" />
          <rect x={51} y={208} width={6} height={20} fill="#F2C14E" />
          <rect x={150} y={212} width={24} height={16} rx={3} fill="#5468C9" />
          <rect x={159} y={212} width={6} height={16} fill="#FFFFFF" />
          <rect x={72} y={216} width={17} height={12} rx={3} fill="#3BAF8E" />
        </svg>
        <span style={{ position: "absolute", top: 150, right: 56, width: 64, height: 80, transformOrigin: "50% 100%", animation: "cdSway 3.8s ease-in-out infinite" }}>
          <svg width={64} height={80} viewBox="0 0 64 80">
            <ellipse cx={32} cy={76} rx={24} ry={4} fill="rgba(190,200,225,0.45)" />
            <circle cx={32} cy={56} r={20} fill="#FFFFFF" stroke="#DCE3F0" strokeWidth={1.5} />
            <circle cx={32} cy={26} r={14} fill="#FFFFFF" stroke="#DCE3F0" strokeWidth={1.5} />
            <rect x={22} y={6} width={20} height={10} rx={1.5} fill="#2A3040" />
            <rect x={18} y={14} width={28} height={4} rx={2} fill="#2A3040" />
            <circle cx={27} cy={24} r={1.6} fill="#2A3040" />
            <circle cx={37} cy={24} r={1.6} fill="#2A3040" />
            <polygon points="32,26 46,28 32,30" fill="#E8813E" />
            <rect x={23} y={37} width={18} height={6} rx={3} fill="#D84B3F" />
            <rect x={33} y={40} width={6} height={14} rx={3} fill="#D84B3F" />
            <path d="M12 50 L0 40 M52 50 L64 38" stroke="#8A6240" strokeWidth={3} strokeLinecap="round" />
            <circle cx={32} cy={50} r={1.9} fill="#2A3040" />
            <circle cx={32} cy={58} r={1.9} fill="#2A3040" />
          </svg>
        </span>
        <span style={{ position: "absolute", top: 16, left: 0, width: 150, height: 48, animation: "cdSleigh 13s linear infinite", filter: "drop-shadow(0 4px 6px rgba(60,70,110,0.25))" }}>
          <svg width={150} height={48} viewBox="0 0 150 48">
            <path d="M4 40 q-3 6 5 8 h32" stroke="#E8C05A" strokeWidth={2.5} fill="none" strokeLinecap="round" />
            <path d="M10 22 q-9 10 3 17 h28 q11 0 12 -11 l-1 -9 h-26 q-10 0 -16 3 z" fill="#B8402F" />
            <circle cx={18} cy={18} r={8} fill="#8A6240" />
            <circle cx={36} cy={12} r={5} fill="#F7D9C4" />
            <polygon points="30,10 36,0 42,10" fill="#D84B3F" />
            <circle cx={42} cy={1.5} r={2} fill="#FFFFFF" />
            <rect x={30} y={10} width={12} height={3} rx={1.5} fill="#FFFFFF" />
            <rect x={29} y={15} width={15} height={11} rx={4} fill="#D84B3F" />
            <path d="M54 26 L88 24 L120 22" stroke="#6E4E3A" strokeWidth={1.5} fill="none" />
            <ellipse cx={94} cy={30} rx={12} ry={6.5} fill="#8A6240" />
            <path d="M88 36 v8 M100 36 v8" stroke="#6E4E3A" strokeWidth={2.4} strokeLinecap="round" />
            <circle cx={106} cy={21} r={4.5} fill="#8A6240" />
            <path d="M106 17 q-2 -6 -7 -8 M107 17 q3 -6 8 -7" stroke="#6E4E3A" strokeWidth={1.8} fill="none" strokeLinecap="round" />
            <ellipse cx={124} cy={28} rx={12} ry={6.5} fill="#96714E" />
            <path d="M118 34 v8 M130 34 v8" stroke="#6E4E3A" strokeWidth={2.4} strokeLinecap="round" />
            <circle cx={136} cy={19} r={4.5} fill="#96714E" />
            <path d="M136 15 q-2 -6 -7 -8 M137 15 q3 -6 8 -7" stroke="#6E4E3A" strokeWidth={1.8} fill="none" strokeLinecap="round" />
            <circle cx={140} cy={20} r={2} fill="#E8433A" style={{ animation: "cdTwinkle 1.2s ease-in-out infinite" }} />
          </svg>
        </span>
      </SceneCanvas>
      <SnowLayer tall top={{ top: 8, left: 0, right: 0, bottom: 0 }} />
    </>
  );
}

function SummerScene({ scale }: SceneProps) {
  return (
    <>
      <SceneBand scale={scale} vbH={286}>
        <defs>
          <linearGradient id="wSeaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6BC1E8" />
            <stop offset="100%" stopColor="#3E9BD6" />
          </linearGradient>
        </defs>
        <rect x={0} y={156} width={400} height={74} fill="url(#wSeaGrad)" />
        <rect x={0} y={156} width={400} height={3} fill="rgba(255,255,255,0.55)" />
        <rect x={80} y={180} width={12} height={2.6} rx={1.3} fill="rgba(255,255,255,0.8)" style={{ animation: "cdTwinkle 2.4s ease-in-out infinite" }} />
        <rect x={180} y={198} width={9} height={2.4} rx={1.2} fill="rgba(255,255,255,0.7)" style={{ animation: "cdTwinkle 3s ease-in-out infinite", animationDelay: "0.8s" }} />
        <rect x={268} y={174} width={10} height={2.4} rx={1.2} fill="rgba(255,255,255,0.75)" style={{ animation: "cdTwinkle 2.7s ease-in-out infinite", animationDelay: "1.4s" }} />
        <path d="M0 230 Q100 216 200 226 T400 222 L400 286 L0 286 Z" fill="#F2DDB0" />
        <path d="M0 230 Q100 216 200 226 T400 222" stroke="rgba(255,255,255,0.75)" strokeWidth={3} fill="none" />
      </SceneBand>
      <SceneCanvas scale={scale}>
        {/* 요트 — 바다 위를 지나가므로 **모래밭 전경(야자수·파라솔·비치볼)보다 먼저** 그린다. */}
        <span style={{ position: "absolute", top: 148, left: 0, width: 96, height: 56, animation: "cdSail 20s linear infinite" }}>
          <span style={{ position: "absolute", inset: 0, display: "block", animation: "cdBob 4s ease-in-out infinite" }}>
            <svg width={96} height={56} viewBox="0 0 96 56">
              <path d="M4 44 q18 6 40 4 M0 50 q26 8 56 4" stroke="rgba(255,255,255,0.7)" strokeWidth={3} fill="none" strokeLinecap="round" />
              <ellipse cx={76} cy={46} rx={6} ry={3} fill="rgba(255,255,255,0.8)" />
              <line x1={52} y1={8} x2={52} y2={36} stroke="#6E4E3A" strokeWidth={2} />
              <polygon points="52,8 52,36 32,36" fill="#FFFFFF" />
              <polygon points="55,12 55,36 72,36" fill="#E85D5D" />
              <path d="M28 38 q22 10 46 0 l-6 10 h-34 z" fill="#C9542F" />
            </svg>
          </span>
        </span>
        <svg style={{ position: "absolute", inset: 0 }} width={SCENE_W} height={SCENE_H} viewBox="0 0 400 286">
          <ellipse cx={300} cy={236} rx={36} ry={5} fill="rgba(180,150,90,0.3)" />
          <path d="M296 232 C288 192 300 162 286 128" stroke="#9A6B43" strokeWidth={9} fill="none" strokeLinecap="round" />
          <path d="M288 212 q8 4 16 2 M286 190 q8 4 16 2 M288 170 q8 4 15 2 M285 150 q7 3 14 2" stroke="#86592F" strokeWidth={2.2} fill="none" strokeLinecap="round" />
          <g transform="rotate(-10 352 186)">
            <path d="M320 188 Q352 150 384 188 Z" fill="#E85D5D" />
            <path d="M332 186 Q346 156 352 187 Z" fill="#FFFFFF" opacity={0.92} />
            <path d="M358 187 Q364 156 376 185 Z" fill="#FFFFFF" opacity={0.92} />
            {/* 꼭지 — 갓 곡선(Q352 150)의 실제 정점은 y≈169라 시안 좌표(147~154)로는 떠 보인다. 정점에 붙인다. */}
            <line x1={352} y1={172} x2={352} y2={163} stroke="#8A6240" strokeWidth={3} strokeLinecap="round" />
          </g>
          <line x1={352} y1={186} x2={358} y2={232} stroke="#8A6240" strokeWidth={3.5} strokeLinecap="round" />
          <rect x={358} y={234} width={34} height={12} rx={3} fill="#5FB6E8" transform="rotate(-4 375 240)" />
          <path d="M365 236 v9 M374 235 v9 M383 234 v9" stroke="rgba(255,255,255,0.85)" strokeWidth={2.4} transform="rotate(-4 375 240)" />
          <path d="M196 64 q7 -8 15 0 M222 54 q7 -8 15 0" stroke="#7B839C" strokeWidth={2.4} fill="none" strokeLinecap="round" />
        </svg>
        <span style={{ position: "absolute", top: 70, left: 222, width: 130, height: 74, transformOrigin: "49% 78%", animation: "cdSway 5s ease-in-out infinite" }}>
          <svg width={130} height={74} viewBox="0 0 130 74">
            <path d="M64 58 Q30 40 4 48 Q34 56 66 66 Z" fill="#37A385" />
            <path d="M64 58 Q42 22 16 16 Q46 36 66 62 Z" fill="#3BAF8E" />
            <path d="M64 58 Q64 18 48 4 Q72 28 70 60 Z" fill="#2E9678" />
            <path d="M64 58 Q90 20 116 16 Q90 38 68 62 Z" fill="#3BAF8E" />
            <path d="M64 58 Q102 40 126 50 Q96 58 64 68 Z" fill="#37A385" />
            <circle cx={62} cy={66} r={5} fill="#7A5230" />
            <circle cx={73} cy={62} r={5} fill="#6E4A2A" />
          </svg>
        </span>
        <span style={{ position: "absolute", top: 216, right: 60, width: 20, height: 20, animation: "cdRoll 5s ease-in-out infinite" }}>
          <svg width={20} height={20} viewBox="0 0 20 20">
            <circle cx={10} cy={10} r={9} fill="#FFFFFF" stroke="#E3E3E3" strokeWidth={1} />
            <path d="M10 1 A9 9 0 0 1 19 10 L10 10 Z" fill="#E85D5D" />
            <path d="M10 19 A9 9 0 0 1 1 10 L10 10 Z" fill="#5468C9" />
          </svg>
        </span>
      </SceneCanvas>
      <Sun
        glow={{ top: -26, right: -20, width: 150, height: 150, background: "radial-gradient(circle,rgba(255,214,110,0.42),transparent 66%)" }}
        ray={{ top: 6, right: 12, width: 58, height: 58 }}
        core={{ top: 20, right: 26, width: 30, height: 30 }}
      />
      {/* 파도 거품 — 카드 전폭. 수면 위치는 씬 좌표(top 196/286) × 스케일로 환산 */}
      <span style={{ position: "absolute", bottom: (SCENE_H - 236) * scale, left: 0, right: 0, height: 40, overflow: "hidden", display: "block", pointerEvents: "none" }}>
        <span style={{ position: "absolute", bottom: 16, left: "-6%", width: "120%", height: 13, borderRadius: 999, background: "rgba(255,255,255,0.4)", animation: "cdWave 6s ease-in-out infinite" }} />
        <span style={{ position: "absolute", bottom: 2, left: "-4%", width: "130%", height: 12, borderRadius: 999, background: "rgba(255,255,255,0.28)", animation: "cdWave 8s ease-in-out infinite reverse" }} />
      </span>
    </>
  );
}

const SCENES: Record<SceneKind, (p: SceneProps) => React.ReactElement> = {
  맑음: SunnyScene,
  흐림: CloudyScene,
  비: RainScene,
  눈: SnowScene,
  봄: SpringScene,
  가을: AutumnScene,
  여름휴가: SummerScene,
  설날: SeolScene,
  추석: ChuseokScene,
  크리스마스: XmasScene,
};

export function WeatherWidget() {
  const [now, setNow] = useState(() => new Date());
  // 씬 스케일 — 씬은 400×286 고정 좌표계로 그려져 있어, 카드 실측에 맞춰 확대한다.
  const frameRef = useRef<HTMLElement>(null);
  const [sceneScale, setSceneScale] = useState(1);
  const [loc, setLoc] = useState<{ lat: number; lon: number }>({ lat: DEFAULT_LOC.lat, lon: DEFAULT_LOC.lon });
  const [locLabel, setLocLabel] = useState<string | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [seasons, setSeasons] = useState<HolidaySeason[]>([]);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0) setSceneScale(Math.min(r.width / SCENE_W, r.height / SCENE_H));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 실시간 시계.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // 위치 — 허용되면 실제 좌표, 거부/실패면 기본 위치 유지.
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setLoc({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => setLocLabel(DEFAULT_LOC.label),
      { timeout: 8000, maximumAge: 30 * 60 * 1000 }
    );
  }, []);

  // 역지오코딩(무키, BigDataCloud) — 지역명 라벨.
  useEffect(() => {
    let alive = true;
    fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${loc.lat}&longitude=${loc.lon}&localityLanguage=ko`
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !alive) return;
        // 시도 + 시군구 라벨 — localityInfo.administrative 의 OSM adminLevel(4=시도, 6=시군구)에서 뽑는다.
        // (principalSubdivision/city 는 특별시·광역시에서 같은 값이 중복돼 구 단위가 안 나온다.)
        const admin: { name?: string; adminLevel?: number }[] = Array.isArray(d.localityInfo?.administrative)
          ? d.localityInfo.administrative
          : [];
        const sido = admin.find((a) => a.adminLevel === 4)?.name ?? d.principalSubdivision;
        const sigungu =
          admin.find((a) => a.adminLevel === 6)?.name ?? (d.city && d.city !== sido ? d.city : d.locality);
        const parts = [sido, sigungu].filter(Boolean).map((s: string) => String(s).trim());
        const label = Array.from(new Set(parts)).join(" ");
        if (label) setLocLabel(label);
      })
      .catch(() => {
        if (alive) setLocLabel((v) => v ?? DEFAULT_LOC.label);
      });
    return () => {
      alive = false;
    };
  }, [loc]);

  // 날씨(/api/home/weather — 기상청 실황, 실패 시 서버가 Open-Meteo 로 폴백) — 10분 간격 갱신.
  // 초단기실황이 매시 40분경 갱신되므로 30분 주기로는 최대 30분 낡은 기온이 표시된다.
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch(`/api/home/weather?lat=${loc.lat}&lon=${loc.lon}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d || !alive || !Number.isFinite(Number(d.temp))) return;
          setWeather({
            temp: Number(d.temp),
            hi: Math.round(Number(d.hi)),
            lo: Math.round(Number(d.lo)),
            base: (["맑음", "흐림", "비", "눈"] as BaseKind[]).includes(d.base) ? (d.base as BaseKind) : "맑음",
          });
        })
        .catch(() => {
          /* 위젯은 실패해도 침묵 — 시계·날짜는 계속 동작한다 */
        });
    };
    load();
    const t = setInterval(load, 10 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [loc]);

  // 설·추석 시즌 구간(공휴일 API).
  useEffect(() => {
    let alive = true;
    fetch(`/api/home/holidays?year=${new Date().getFullYear()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && alive) setSeasons(Array.isArray(d.seasons) ? d.seasons : []);
      })
      .catch(() => {
        /* 침묵 — 시즌 없이 기본 씬으로 */
      });
    return () => {
      alive = false;
    };
  }, []);

  const todayYmd = kstToday();
  const base: BaseKind = weather?.base ?? "맑음";

  // 씬 결정 — 명절 시즌 > 크리스마스(12월) > 맑음 한정 계절 씬 > 기본 날씨.
  const { scene, badge } = useMemo(() => {
    const month = now.getMonth() + 1;
    const season = seasons.find((s) => todayYmd >= s.start && todayYmd <= s.end);
    const dday = (target: string) =>
      Math.ceil((new Date(`${target}T00:00:00+09:00`).getTime() - new Date(`${todayYmd}T00:00:00+09:00`).getTime()) / 86400000);
    if (season) {
      const label = season.kind === "seol" ? "설" : "추석";
      const n = dday(season.day);
      return { scene: (season.kind === "seol" ? "설날" : "추석") as SceneKind, badge: n > 0 ? `${label} 연휴 D-${n}` : `${label} 연휴` };
    }
    if (month === 12) {
      const n = dday(`${now.getFullYear()}-12-25`);
      return { scene: "크리스마스" as SceneKind, badge: n > 0 ? `성탄 D-${n}` : "크리스마스" };
    }
    if (base === "맑음") {
      if (month >= 3 && month <= 5) return { scene: "봄" as SceneKind, badge: "봄 시즌" };
      if (month === 7 || month === 8) return { scene: "여름휴가" as SceneKind, badge: "휴가 시즌" };
      if (month === 10 || month === 11) return { scene: "가을" as SceneKind, badge: "가을 시즌" };
    }
    return { scene: base as SceneKind, badge: null as string | null };
  }, [base, now, seasons, todayYmd]);

  const meta = SCENE_META[scene];
  const Scene = SCENES[scene];
  const p2 = (n: number) => String(n).padStart(2, "0");
  const WD = ["일", "월", "화", "수", "목", "금", "토"];
  const dateStr = `${now.getMonth() + 1}월 ${now.getDate()}일 ${WD[now.getDay()]}요일`;
  const desc = weather ? (meta.desc ? `${base} · ${meta.desc}` : base) : "-";

  return (
    <section
      ref={frameRef}
      className="cd-reveal relative overflow-hidden flex flex-col shrink-0"
      style={{
        // 내 차례인 결재 카드와 같은 높이 — 좌열(날씨+연차)과 중열(결재+메일)이 정확히 대칭이 된다.
        height: HOME_HALF_H,
        borderRadius: 18,
        border: "1px solid rgba(255,255,255,0.78)",
        boxShadow: "var(--cd-shadow), 0 0 0 1px var(--cd-ring)",
        padding: "16px 18px",
        background: meta.bg,
      }}
    >
      <Scene scale={sceneScale} />
      {/* 좌측 텍스트 가독용 가로 화이트 그라데이션 오버레이 */}
      <span
        className="absolute inset-0 pointer-events-none"
        style={{ background: "linear-gradient(90deg,rgba(255,255,255,0.58) 0%,rgba(255,255,255,0.32) 36%,rgba(255,255,255,0) 60%)" }}
      />
      <div className="flex items-center gap-1.5 relative">
        <MapPin className="w-[13px] h-[13px]" style={{ color: "#6E7690" }} strokeWidth={2} />
        <span className="text-xs font-bold" style={{ color: "#5B6479" }}>
          {locLabel ?? "위치 확인 중"}
        </span>
        {badge && (
          <span
            className="text-[10px] font-extrabold rounded-full px-2 py-[3px] whitespace-nowrap"
            style={{ background: meta.badgeBg, color: meta.badgeFg }}
          >
            {badge}
          </span>
        )}
      </div>
      <div className="mt-auto relative">
        <div className="flex items-baseline gap-1">
          <span className="text-[34px] font-extrabold tabular-nums leading-none tracking-[-0.03em]" style={{ color: "#2A3040" }}>
            {p2(now.getHours())}:{p2(now.getMinutes())}
          </span>
          <span className="text-[12.5px] font-bold tabular-nums" style={{ color: "#7B839C" }}>
            {p2(now.getSeconds())}
          </span>
        </div>
        <p className="mt-[5px] text-xs font-semibold" style={{ color: "#6E7690" }}>
          {dateStr}
        </p>
      </div>
      <div className="mt-2.5 flex items-end gap-2 relative">
        <span className="text-2xl font-extrabold tracking-[-0.02em]" style={{ color: "#2A3040" }}>
          {weather ? `${weather.temp.toFixed(1)}°` : "--°"}
        </span>
        <span className="flex flex-col gap-[1px] pb-[3px]">
          <span className="text-xs font-bold" style={{ color: "#5B6479" }}>
            {desc}
          </span>
          <span className="text-[11px]" style={{ color: "#9AA1B8" }}>
            {weather ? `최고 ${weather.hi}° · 최저 ${weather.lo}°` : " "}
          </span>
        </span>
      </div>
    </section>
  );
}
