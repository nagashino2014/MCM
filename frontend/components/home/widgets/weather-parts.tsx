"use client";

// 날씨/시계 위젯 공용 파츠 — WeatherWidget(주간 씬)과 weather-night(야간 씬)가 공유한다.
// 렌더 구조 3층(핸드오프 그대로):
//  ① SceneBand   풍경 밴드: preserveAspectRatio="none" 으로 카드 폭에 꽉 채움(가로 스트레치)
//  ② SceneCanvas 오브젝트 캔버스(400×286): 통째 scale — 인물·나무·건물이 왜곡되지 않는다
//  ③ 파티클      비·눈·꽃잎·낙엽: 카드 전폭에 뿌린다(음수 animation-delay 로 위상 분산)

/** 씬 캔버스 원본 크기 — 시안의 모든 씬 좌표(SVG·absolute 오브젝트)가 이 좌표계 기준이다. */
export const SCENE_W = 400;
export const SCENE_H = 286;

export interface SceneProps {
  scale: number;
}

/** ② 오브젝트 캔버스 — 400×286 좌표계를 통째로 스케일한다(비왜곡).
 *  bottom: 지면이 있는 풍경 씬(하단 중앙 고정) / topRight: 하늘 씬(구름·해가 우상단 코너 기준). */
export function SceneCanvas({ scale, anchor = "bottom", children }: { scale: number; anchor?: "bottom" | "topRight"; children: React.ReactNode }) {
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
export function SceneBand({ scale, vbH, children }: { scale: number; vbH: number; children: React.ReactNode }) {
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

// ── 낙하 파티클 — 음수 animation-delay 로 시작 즉시 무작위 분포(시안 생성 공식 그대로) ──
export const RAINS = Array.from({ length: 10 }, (_, i) => ({
  l: 3 + i * 10, h: 9 + (i % 3) * 4, sp: (1.0 + (i % 4) * 0.14).toFixed(2), d: (i * 0.19 % 1.3).toFixed(2),
}));
export const SNOWS = Array.from({ length: 12 }, (_, i) => ({
  l: 2 + i * 8.5, s: 3 + (i % 4), o: (0.55 + (i % 3) * 0.2).toFixed(2), sp: (2.6 + (i % 4) * 0.5).toFixed(1), d: (i * 0.55 % 3.8).toFixed(2),
}));
export const PETALS = Array.from({ length: 14 }, (_, i) => ({
  l: 2 + i * 7, s: 6 + (i % 3), s2: 5 + (i % 2) * 2,
  c: ["#F7C7D4", "#F4B7C8", "#F0A9BE"][i % 3],
  sp: (4.4 + (i % 4) * 0.7).toFixed(1), d: (i * 0.62 % 4.9).toFixed(2),
}));
export const MAPLES = Array.from({ length: 9 }, (_, i) => ({
  l: 3 + i * 11, c: ["#D45C33", "#E7A14E", "#C94B2E", "#DB7B3C", "#B0432A"][i % 5],
  sp: (4.6 + (i % 4) * 0.6).toFixed(1), d: (i * 0.7 % 4.8).toFixed(2),
}));

/** ③ 빗줄기 레이어 — 주간 rgba(90,120,220) / 야간 rgba(140,170,240)(발광 톤). */
export function RainLayer({ top, color = "90,120,220" }: { top: React.CSSProperties; color?: string }) {
  return (
    <span style={{ position: "absolute", overflow: "hidden", display: "block", pointerEvents: "none", transform: "rotate(7deg)", ...top }}>
      {RAINS.map((r, i) => (
        <span
          key={i}
          style={{
            position: "absolute", top: 0, left: `${r.l}%`, width: 2, height: r.h, borderRadius: 2,
            background: `linear-gradient(180deg,rgba(${color},0),rgba(${color},0.62))`,
            animation: `cdRain ${r.sp}s linear infinite`, animationDelay: `-${r.d}s`,
          }}
        />
      ))}
    </span>
  );
}

/** ③ 눈 파티클 레이어(카드 전폭) — 기본 눈=cdSnow 94px / 설날·크리스마스=cdSnowTall 전체 높이.
 *  glow: 야간 발광 눈송이(box-shadow rgba(200,215,255,0.85)). */
export function SnowLayer({ tall, glow, top }: { tall?: boolean; glow?: boolean; top: React.CSSProperties }) {
  return (
    <span style={{ position: "absolute", overflow: "hidden", display: "block", pointerEvents: "none", ...top }}>
      {SNOWS.map((s, i) => (
        <span
          key={i}
          style={{
            position: "absolute", top: 0, left: `${s.l}%`, width: s.s, height: s.s, borderRadius: 999,
            background: `rgba(255,255,255,${s.o})`,
            boxShadow: glow ? "0 0 6px rgba(200,215,255,0.85)" : "0 0 5px rgba(170,190,235,0.7)",
            animation: `${tall ? "cdSnowTall" : "cdSnow"} ${s.sp}s linear infinite`, animationDelay: `-${s.d}s`,
          }}
        />
      ))}
    </span>
  );
}

/** 태양(광선 회전 + 코어 펄스) — 맑음/여름휴가 공용. */
export function Sun({ ray, core, glow }: { ray: React.CSSProperties; core: React.CSSProperties; glow: React.CSSProperties }) {
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
export function Cloud({
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

export const W_WHITE = "linear-gradient(180deg,#FFFFFF,#EAEFF8)";
export const W_WHITE2 = "linear-gradient(180deg,#FFFFFF,#F0F3FA)";

/** 벚나무/단풍나무 — 봄·가을 공용 구조(줄기 + 원형 캐노피, 색만 다르다). id 로 작은 나무가 재사용. */
export function SceneTree({ id, trunk, canopy, twinkle }: {
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

/** 하늘의 새 2마리 — 봄·가을 공용 오브젝트(스트레치되면 안 되므로 캔버스에 얹는다). */
export function SkyBirds() {
  return (
    <svg style={{ position: "absolute", left: 0, bottom: 0 }} width={SCENE_W} height={240} viewBox="0 0 400 240">
      <path d="M66 52 q7 -8 15 0 M92 42 q7 -8 15 0" stroke="#9AA1B8" strokeWidth={2.2} fill="none" strokeLinecap="round" />
    </svg>
  );
}

// ── 야간 공용 파츠(핸드오프 야간 공통 규칙 ①: 밤하늘 연출 — 별·달·광륜) ──────────────

/** 트윙클 별 무리 — 씬별 좌표만 받는다(2~3px 원). */
export function NightStars({ stars }: { stars: { top: number; right: number; s: number; sp: string; delay?: string; bright?: boolean }[] }) {
  return (
    <>
      {stars.map((st, i) => (
        <span
          key={i}
          style={{
            position: "absolute", top: st.top, right: st.right, width: st.s, height: st.s, borderRadius: 999,
            background: st.bright ? "#EAF0FF" : "#CBD6F5",
            animation: `cdTwinkle ${st.sp} ease-in-out infinite`, animationDelay: st.delay,
          }}
        />
      ))}
    </>
  );
}

/** 십자 반짝이 별(별모양 svg) — 맑은 밤·밤바다의 큰 별. */
export function SparkleStar({ top, right, s, sp, delay, fill = "#F2F6FF" }: { top: number; right: number; s: number; sp: string; delay?: string; fill?: string }) {
  return (
    <span style={{ position: "absolute", top, right, width: s, height: s, animation: `cdTwinkle ${sp} ease-in-out infinite`, animationDelay: delay }}>
      <svg width={s} height={s} viewBox="0 0 14 14">
        <path d="M7 0 L8.3 5.7 L14 7 L8.3 8.3 L7 14 L5.7 8.3 L0 7 L5.7 5.7 Z" fill={fill} />
      </svg>
    </span>
  );
}

/** 달 — radial 코어 + box-shadow 글로우. craters 로 표면 크레이터를 얹는다. */
export function Moon({ top, right, s, glow = "0 0 18px 4px rgba(240,230,175,0.3)", craters }: {
  top: number; right: number; s: number; glow?: string;
  craters?: { t: number; l: number; s: number; o: number }[];
}) {
  return (
    <span
      style={{
        position: "absolute", top, right, width: s, height: s, borderRadius: 999,
        background: "radial-gradient(circle at 36% 32%,#FDFBEE,#EFE7C6 58%,#D9CFA6)", boxShadow: glow,
      }}
    >
      {craters?.map((c, i) => (
        <span key={i} style={{ position: "absolute", top: c.t, left: c.l, width: c.s, height: c.s, borderRadius: 999, background: `rgba(200,188,145,${c.o})` }} />
      ))}
    </span>
  );
}

/** 달무리(광륜) — cdMoonHalo 펄스. */
export function MoonHalo({ top, right, s, alpha = 0.16, sp = "5s" }: { top: number; right: number; s: number; alpha?: number; sp?: string }) {
  return (
    <span
      style={{
        position: "absolute", top, right, width: s, height: s, borderRadius: 999,
        background: `radial-gradient(circle,rgba(240,232,180,${alpha}),transparent 66%)`,
        animation: `cdMoonHalo ${sp} ease-in-out infinite`,
      }}
    />
  );
}

/** 반딧불 — cdFirefly 궤적 + 노란 글로우(야간 광원 ②). */
export function Firefly({ top, left, s, sp, delay, soft }: { top: number; left: number; s: number; sp: string; delay?: string; soft?: boolean }) {
  return (
    <span
      style={{
        position: "absolute", top, left, width: s, height: s, borderRadius: 999,
        background: soft ? "#FFF1BE" : "#FFE9A0",
        boxShadow: s >= 5 ? "0 0 9px 3px rgba(255,224,130,0.75)" : "0 0 8px 2px rgba(255,224,130,0.7)",
        animation: `cdFirefly ${sp} ease-in-out infinite`, animationDelay: delay,
      }}
    />
  );
}

/** 유성 — cdShoot(8s 주기, 좌하향 낙하). */
export function ShootingStar({ top, right, w = 64 }: { top: number; right: number; w?: number }) {
  return (
    <span style={{ position: "absolute", top, right, width: w, height: 2, animation: "cdShoot 8s linear infinite" }}>
      <span style={{ position: "absolute", inset: 0, borderRadius: 2, background: "linear-gradient(90deg,#FFFFFF,rgba(255,255,255,0))", transform: "rotate(-27deg)" }} />
    </span>
  );
}
