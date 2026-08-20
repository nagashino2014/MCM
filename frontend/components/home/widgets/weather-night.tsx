"use client";

// 야간 씬 10종 — Soft Glass Ink 핸드오프 야간 확정안(리디자인 전개 3a~3c·4a~4g) 1:1 이식.
// 야간 공통 규칙 3가지(핸드오프):
//  ① 밤하늘 연출 — 딥 네이비 그라데이션(씬별 165deg 3-stop) + 트윙클 별 + 씬별 달(광륜 halo)
//  ② 야간 광원이 주인공 — 유성·반딧불·모닥불·달빛 물결·번개·창호 불빛·전구 글로우·널뛰기
//  ③ 텍스트/스크림 야간 반전 — WeatherWidget 본체에서 처리(여기는 씬 레이어만)
// 좌표는 전부 시안의 400×286 캔버스 기준이며, 주간과 같은 3층 구조(밴드/캔버스/파티클)로 나눈다.

import {
  SCENE_W, SCENE_H, type SceneProps,
  SceneCanvas, SceneBand, SnowLayer, RainLayer, Cloud, SceneTree,
  NightStars, SparkleStar, Moon, MoonHalo, Firefly, ShootingStar,
} from "./weather-parts";

// 야간 구름 그라데이션(달빛 림라이트 톤)
const N_CLOUD = "linear-gradient(180deg,#55628E,#3A4569)";
const N_CLOUD2 = "linear-gradient(180deg,#5E6C9A,#414D74)";
const N_CLOUD_DIM = "linear-gradient(180deg,#48547E,#333E60)";
const N_CLOUD_DIM2 = "linear-gradient(180deg,#505D88,#3A4569)";
const N_CLOUD_DARK = "linear-gradient(180deg,#3A4569,#2C3654)";
const N_CLOUD_DARK2 = "linear-gradient(180deg,#414D74,#333E60)";

export function NightSunnyScene({ scale }: SceneProps) {
  return (
    <SceneCanvas scale={scale} anchor="topRight">
      <MoonHalo top={-32} right={-28} s={190} alpha={0.2} sp="4.5s" />
      <Moon
        top={20} right={26} s={54} glow="0 0 24px 6px rgba(240,230,175,0.35)"
        craters={[{ t: 12, l: 14, s: 9, o: 0.5 }, { t: 28, l: 30, s: 6, o: 0.42 }, { t: 31, l: 12, s: 4.5, o: 0.38 }]}
      />
      <NightStars
        stars={[
          { top: 26, right: 118, s: 3, sp: "2.6s", bright: true },
          { top: 58, right: 160, s: 2, sp: "3.4s", delay: "0.7s" },
          { top: 14, right: 200, s: 2.5, sp: "3s", delay: "1.4s", bright: true },
          { top: 92, right: 36, s: 2, sp: "2.8s", delay: "0.4s" },
          { top: 110, right: 120, s: 3, sp: "3.6s", delay: "1.9s", bright: true },
        ]}
      />
      <SparkleStar top={48} right={96} s={14} sp="3.2s" delay="1s" />
      <SparkleStar top={128} right={190} s={10} sp="4s" delay="2.3s" fill="#D8E2FA" />
      <ShootingStar top={34} right={250} />
      <Cloud
        wrap={{ top: 112, right: 64, width: 104, height: 38, filter: "drop-shadow(0 4px 7px rgba(8,12,30,0.4))" }}
        anim="cdCloudA 9s ease-in-out infinite"
        base={{ w: 104, h: 26, c: N_CLOUD }}
        puffs={[{ b: 10, l: 16, s: 35, c: N_CLOUD2 }, { b: 10, l: 48, s: 27, c: N_CLOUD }]}
      />
      <Cloud
        wrap={{ top: 168, right: 16, width: 78, height: 28, opacity: 0.7 }}
        anim="cdCloudB 12s ease-in-out infinite"
        base={{ w: 78, h: 19, c: N_CLOUD_DIM }}
        puffs={[{ b: 8, l: 13, s: 25, c: N_CLOUD_DIM2 }]}
      />
    </SceneCanvas>
  );
}

export function NightCloudyScene({ scale }: SceneProps) {
  return (
    <SceneCanvas scale={scale} anchor="topRight">
      <NightStars
        stars={[
          { top: 96, right: 212, s: 2.5, sp: "3s", bright: true },
          { top: 150, right: 150, s: 2, sp: "3.6s", delay: "1.2s" },
          { top: 170, right: 250, s: 2, sp: "2.7s", delay: "0.5s" },
        ]}
      />
      <Cloud
        wrap={{ top: 48, right: 118, width: 108, height: 42, opacity: 0.75 }}
        anim="cdCloudB 11s ease-in-out infinite"
        base={{ w: 108, h: 28, c: N_CLOUD_DARK }}
        puffs={[{ b: 11, l: 16, s: 38, c: N_CLOUD_DARK2 }, { b: 11, l: 50, s: 28, c: N_CLOUD_DARK }]}
      />
      <MoonHalo top={-14} right={18} s={130} alpha={0.14} />
      <Moon top={22} right={62} s={40} />
      <Cloud
        wrap={{ top: 34, right: 14, width: 136, height: 54, filter: "drop-shadow(0 5px 8px rgba(8,12,30,0.4))" }}
        anim="cdCloudA 8s ease-in-out infinite"
        base={{ w: 136, h: 34, c: N_CLOUD }}
        puffs={[{ b: 14, l: 17, s: 48, c: N_CLOUD2 }, { b: 14, l: 60, s: 37, c: N_CLOUD }]}
      />
      <Cloud
        wrap={{ top: 126, right: 36, width: 96, height: 30, opacity: 0.6 }}
        anim="cdCloudA 13s ease-in-out infinite reverse"
        base={{ w: 96, h: 20, c: N_CLOUD_DIM }}
        puffs={[{ b: 8, l: 14, s: 28, c: N_CLOUD_DIM2 }]}
      />
      <span
        style={{
          position: "absolute", top: 112, right: 150, width: 80, height: 11, borderRadius: 999,
          background: "linear-gradient(90deg,transparent,rgba(110,125,175,0.5),transparent)",
          animation: "cdHaze 6s ease-in-out infinite",
        }}
      />
    </SceneCanvas>
  );
}

export function NightRainScene({ scale }: SceneProps) {
  return (
    <SceneCanvas scale={scale} anchor="topRight">
      <NightStars
        stars={[
          { top: 120, right: 230, s: 2, sp: "3.4s" },
          { top: 12, right: 250, s: 2.5, sp: "2.8s", delay: "1s", bright: true },
        ]}
      />
      {/* 원거리 번개 — 7s 이중 섬광(cdFlash): 확산광 + 낙뢰 폴리라인이 같은 위상으로 점멸 */}
      <span
        style={{
          position: "absolute", top: 26, right: 120, width: 150, height: 130, borderRadius: 999,
          background: "radial-gradient(circle,rgba(170,195,255,0.4),transparent 62%)",
          animation: "cdFlash 7s linear infinite",
        }}
      />
      <span style={{ position: "absolute", top: 56, right: 172, width: 44, height: 96, animation: "cdFlash 7s linear infinite" }}>
        <svg width={44} height={96} viewBox="0 0 60 110">
          <polyline points="38,0 22,44 34,44 16,100" stroke="#DCE8FF" strokeWidth={3.4} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </span>
      <RainLayer top={{ top: 52, right: 8, width: 225, height: 130 }} color="140,170,240" />
      <Cloud
        wrap={{ top: 38, right: 126, width: 96, height: 34, opacity: 0.85, zIndex: 1 }}
        anim="cdCloudB 10s ease-in-out infinite"
        base={{ w: 96, h: 24, c: N_CLOUD_DARK }}
        puffs={[{ b: 9, l: 14, s: 33, c: N_CLOUD_DARK2 }]}
      />
      <Cloud
        wrap={{ top: 10, right: 18, width: 128, height: 50, filter: "drop-shadow(0 5px 9px rgba(6,10,26,0.45))", zIndex: 1 }}
        anim="cdCloudA 8s ease-in-out infinite"
        base={{ w: 128, h: 31, c: N_CLOUD }}
        puffs={[{ b: 13, l: 16, s: 45, c: N_CLOUD2 }, { b: 13, l: 57, s: 34, c: N_CLOUD }]}
      />
    </SceneCanvas>
  );
}

export function NightSnowScene({ scale }: SceneProps) {
  // 눈 밤은 달이 없다(핸드오프) — 발광 눈송이가 광원.
  return (
    <SceneCanvas scale={scale} anchor="topRight">
      <NightStars
        stars={[
          { top: 110, right: 250, s: 2.5, sp: "3s", bright: true },
          { top: 150, right: 170, s: 2, sp: "3.6s", delay: "1.4s" },
          { top: 16, right: 250, s: 2, sp: "2.6s", delay: "0.6s" },
          { top: 22, right: 160, s: 2.5, sp: "3.3s", delay: "2s", bright: true },
        ]}
      />
      <SnowLayer glow top={{ top: 52, right: 8, width: 235, height: 130 }} />
      <Cloud
        wrap={{ top: 38, right: 124, width: 92, height: 32, opacity: 0.85, zIndex: 1 }}
        anim="cdCloudB 11s ease-in-out infinite"
        base={{ w: 92, h: 23, c: N_CLOUD }}
        puffs={[{ b: 8, l: 14, s: 31, c: N_CLOUD2 }]}
      />
      <Cloud
        wrap={{ top: 9, right: 20, width: 126, height: 50, filter: "drop-shadow(0 5px 9px rgba(8,12,30,0.4))", zIndex: 1 }}
        anim="cdCloudA 9s ease-in-out infinite"
        base={{ w: 126, h: 31, c: "linear-gradient(180deg,#8E99BE,#55628E)" }}
        puffs={[{ b: 13, l: 15, s: 45, c: "linear-gradient(180deg,#98A4C8,#5E6C9A)" }, { b: 13, l: 56, s: 34, c: "linear-gradient(180deg,#8E99BE,#55628E)" }]}
      />
    </SceneCanvas>
  );
}

// ── 봄 밤(3b) — 달빛 벚나무 + 반딧불 ─────────────────────────────────────────────

const N_SPRING_CANOPY = [
  { cx: 52, cy: 78, r: 17, f: "#A06B88" }, { cx: 78, cy: 58, r: 21, f: "#B37E98" }, { cx: 108, cy: 46, r: 24, f: "#A06B88" },
  { cx: 140, cy: 52, r: 22, f: "#B37E98" }, { cx: 164, cy: 68, r: 19, f: "#A06B88" }, { cx: 178, cy: 92, r: 16, f: "#8E5E78" },
  { cx: 96, cy: 74, r: 18, f: "#8E5E78" }, { cx: 126, cy: 70, r: 19, f: "#B37E98" }, { cx: 152, cy: 86, r: 17, f: "#A06B88" },
  { cx: 66, cy: 96, r: 15, f: "#B37E98" }, { cx: 88, cy: 92, r: 14, f: "#A06B88" }, { cx: 118, cy: 88, r: 16, f: "#8E5E78" },
  { cx: 142, cy: 104, r: 14, f: "#B37E98" }, { cx: 168, cy: 114, r: 12, f: "#8E5E78" }, { cx: 104, cy: 60, r: 15, f: "#B37E98" },
  { cx: 58, cy: 60, r: 13, f: "#A06B88" }, { cx: 150, cy: 138, r: 13, f: "#A06B88" }, { cx: 162, cy: 146, r: 10, f: "#B37E98" },
  { cx: 144, cy: 150, r: 9, f: "#8E5E78" }, { cx: 100, cy: 50, r: 9, f: "#C795AC" }, { cx: 134, cy: 58, r: 8, f: "#C795AC" },
  { cx: 72, cy: 66, r: 7, f: "#C795AC" }, { cx: 158, cy: 76, r: 7, f: "#C795AC" }, { cx: 90, cy: 80, r: 6, f: "#C795AC" },
];
const N_SPRING_TWINKLE = [
  { cx: 112, cy: 66, r: 3.2, f: "#E8C2D2", sp: "3s" },
  { cx: 146, cy: 72, r: 3.2, f: "#E8C2D2", sp: "3.6s", delay: "0.8s" },
  { cx: 74, cy: 82, r: 2.8, f: "#E8C2D2", sp: "3.2s", delay: "1.6s" },
  { cx: 170, cy: 96, r: 2.8, f: "#E8C2D2", sp: "3.4s", delay: "2.2s" },
];

const N_PETALS = [
  { l: 52, w: 9, h: 8, c: "rgba(214,160,184,0.85)", sp: "7.2", d: "2.1" },
  { l: 64, w: 8, h: 7, c: "rgba(199,149,172,0.8)", sp: "8.4", d: "5.6" },
  { l: 78, w: 10, h: 8, c: "rgba(226,176,196,0.85)", sp: "6.6", d: "0.9" },
  { l: 88, w: 8, h: 7, c: "rgba(214,160,184,0.75)", sp: "7.8", d: "4.2" },
  { l: 70, w: 7, h: 6, c: "rgba(199,149,172,0.7)", sp: "9", d: "6.8" },
  { l: 58, w: 8, h: 7, c: "rgba(226,176,196,0.8)", sp: "7.5", d: "3.3" },
];

export function NightSpringScene({ scale }: SceneProps) {
  return (
    <>
      <SceneBand scale={scale} vbH={240}>
        <path d="M0 186 Q100 162 210 178 T400 172 L400 240 L0 240 Z" fill="rgba(56,78,92,0.5)" />
        <path d="M0 208 Q120 196 240 204 T400 200 L400 240 L0 240 Z" fill="rgba(68,94,104,0.8)" />
        <ellipse cx={240} cy={214} rx={5} ry={2.4} fill="rgba(196,140,164,0.55)" />
        <ellipse cx={268} cy={220} rx={4.5} ry={2.2} fill="rgba(184,128,152,0.5)" />
        <ellipse cx={312} cy={216} rx={5} ry={2.4} fill="rgba(205,152,175,0.55)" />
        <ellipse cx={204} cy={218} rx={4} ry={2} fill="rgba(196,140,164,0.45)" />
        <path d="M64 208 q2 -9 6 -11 M76 210 q1 -8 5 -10 M158 206 q2 -9 6 -11 M170 208 q2 -8 5 -10" stroke="#4E7460" strokeWidth={2.2} fill="none" strokeLinecap="round" />
      </SceneBand>
      <SceneCanvas scale={scale}>
        <MoonHalo top={0} right={110} s={130} alpha={0.18} />
        <Moon top={38} right={150} s={36} glow="0 0 18px 4px rgba(240,230,175,0.32)" />
        <NightStars
          stars={[
            { top: 30, right: 150, s: 2.5, sp: "3s", bright: true },
            { top: 64, right: 262, s: 2, sp: "3.5s", delay: "1.1s" },
            { top: 12, right: 118, s: 2.5, sp: "2.7s", delay: "0.5s", bright: true },
            { top: 44, right: 60, s: 2, sp: "3.8s", delay: "1.8s" },
          ]}
        />
        <span style={{ position: "absolute", top: 132, right: 116, width: 120, height: 122, transformOrigin: "58% 100%", animation: "cdTreeSway 7.2s ease-in-out infinite", opacity: 0.95 }}>
          <svg width={120} height={122} viewBox="0 0 200 204"><use href="#treeSpringN" /></svg>
        </span>
        <span style={{ position: "absolute", top: 74, right: 6, width: 180, height: 184, transformOrigin: "58% 100%", animation: "cdTreeSway 6s ease-in-out infinite" }}>
          <svg width={180} height={184} viewBox="0 0 200 204">
            <SceneTree id="treeSpringN" trunk="#4E3A50" canopy={N_SPRING_CANOPY} twinkle={N_SPRING_TWINKLE} />
          </svg>
        </span>
        <Firefly top={186} left={74} s={5} sp="4.6s" />
        <Firefly top={206} left={128} s={4} sp="5.4s" delay="1.3s" />
        <Firefly top={170} left={180} s={4} sp="4s" delay="2.4s" soft />
        <Firefly top={222} left={236} s={5} sp="5s" delay="0.7s" />
        <Firefly top={196} left={308} s={4} sp="4.4s" delay="3.1s" soft />
      </SceneCanvas>
      <span style={{ position: "absolute", top: 44, left: 0, right: 0, bottom: 0, overflow: "hidden", display: "block", pointerEvents: "none" }}>
        {N_PETALS.map((pt, i) => (
          <span
            key={i}
            style={{
              position: "absolute", top: 0, left: `${pt.l}%`, width: pt.w, height: pt.h,
              borderRadius: "60% 40% 55% 45%", background: pt.c,
              animation: `cdPetal ${pt.sp}s ease-in infinite`, animationDelay: `-${pt.d}s`,
            }}
          />
        ))}
      </span>
    </>
  );
}

// ── 가을 밤(4d) — 달빛 단풍 + 갈대 실루엣 + 반딧불 ────────────────────────────────

const N_AUTUMN_CANOPY = [
  { cx: 52, cy: 78, r: 17, f: "#9C6B3A" }, { cx: 78, cy: 58, r: 21, f: "#8E5636" }, { cx: 108, cy: 46, r: 24, f: "#7E4A2E" },
  { cx: 140, cy: 52, r: 22, f: "#8E5636" }, { cx: 164, cy: 68, r: 19, f: "#6E3E28" }, { cx: 178, cy: 92, r: 16, f: "#7E4A2E" },
  { cx: 96, cy: 74, r: 18, f: "#6E3E28" }, { cx: 126, cy: 70, r: 19, f: "#9C6B3A" }, { cx: 152, cy: 86, r: 17, f: "#8E5636" },
  { cx: 66, cy: 96, r: 15, f: "#7E4A2E" }, { cx: 88, cy: 92, r: 14, f: "#8E5636" }, { cx: 118, cy: 88, r: 16, f: "#6E3E28" },
  { cx: 142, cy: 104, r: 14, f: "#9C6B3A" }, { cx: 168, cy: 114, r: 12, f: "#8E5636" }, { cx: 104, cy: 60, r: 15, f: "#9C6B3A" },
  { cx: 58, cy: 60, r: 13, f: "#8E5636" }, { cx: 150, cy: 138, r: 13, f: "#8E5636" }, { cx: 162, cy: 146, r: 10, f: "#9C6B3A" },
  { cx: 144, cy: 150, r: 9, f: "#6E3E28" }, { cx: 100, cy: 50, r: 9, f: "#B07C4A" }, { cx: 134, cy: 58, r: 8, f: "#B07C4A" },
  { cx: 72, cy: 66, r: 7, f: "#B07C4A" }, { cx: 158, cy: 76, r: 7, f: "#B07C4A" },
];
const N_AUTUMN_TWINKLE = [
  { cx: 112, cy: 66, r: 3.4, f: "#C88A50", sp: "3.4s" },
  { cx: 146, cy: 72, r: 3.4, f: "#C88A50", sp: "3.8s", delay: "1s" },
  { cx: 74, cy: 82, r: 3, f: "#C88A50", sp: "3.6s", delay: "1.8s" },
];

/** 가을 밤 갈대 실루엣 — 주간 7개 대신 5개(시안). */
const N_REEDS: { top: number; left?: number; right?: number; h: number; soft?: boolean; dark?: boolean; ear: string; side?: "l" | "r" }[] = [
  { top: 194, left: 128, h: 70, ear: "#8A7148", side: "l" },
  { top: 202, left: 152, h: 62, soft: true, ear: "#9A805A", side: "r" },
  { top: 192, left: 176, h: 72, dark: true, ear: "#8A7148" },
  { top: 198, right: 4, h: 66, soft: true, ear: "#9A805A", side: "l" },
  { top: 196, left: 206, h: 60, dark: true, ear: "#9A805A" },
];

const N_MAPLES = [
  { l: 56, w: 14, h: 11, c: "rgba(142,74,48,0.9)", sp: "7", d: "1.8" },
  { l: 68, w: 13, h: 10, c: "rgba(156,107,58,0.85)", sp: "8.2", d: "4.6" },
  { l: 80, w: 14, h: 11, c: "rgba(126,74,46,0.9)", sp: "6.4", d: "0.7" },
  { l: 90, w: 12, h: 9, c: "rgba(176,112,74,0.8)", sp: "7.6", d: "3.2" },
];

export function NightAutumnScene({ scale }: SceneProps) {
  return (
    <>
      <SceneBand scale={scale} vbH={240}>
        <path d="M0 186 Q100 162 210 178 T400 172 L400 240 L0 240 Z" fill="rgba(96,78,72,0.5)" />
        <path d="M0 208 Q120 196 240 204 T400 200 L400 240 L0 240 Z" fill="rgba(118,96,84,0.75)" />
        <ellipse cx={238} cy={214} rx={7} ry={3} fill="rgba(142,74,48,0.7)" />
        <ellipse cx={268} cy={220} rx={6} ry={2.8} fill="rgba(156,107,58,0.65)" />
        <ellipse cx={310} cy={216} rx={7} ry={3} fill="rgba(126,74,46,0.7)" />
        <ellipse cx={204} cy={218} rx={6} ry={2.6} fill="rgba(142,74,48,0.6)" />
        <ellipse cx={352} cy={220} rx={6} ry={2.6} fill="rgba(156,107,58,0.55)" />
      </SceneBand>
      <SceneCanvas scale={scale}>
        <MoonHalo top={0} right={172} s={120} alpha={0.16} />
        <Moon top={32} right={212} s={34} glow="0 0 16px 4px rgba(240,230,175,0.3)" />
        <NightStars
          stars={[
            { top: 24, right: 120, s: 2.5, sp: "2.9s", bright: true },
            { top: 60, right: 60, s: 2, sp: "3.5s", delay: "1.1s" },
            { top: 12, right: 280, s: 2, sp: "3.2s", delay: "0.4s" },
            { top: 82, right: 150, s: 2.5, sp: "3.8s", delay: "2.1s", bright: true },
            { top: 44, right: 36, s: 2, sp: "2.6s", delay: "0.9s" },
            { top: 120, right: 250, s: 2, sp: "3.3s", delay: "1.6s", bright: true },
          ]}
        />
        <span style={{ position: "absolute", top: 132, right: 116, width: 120, height: 122, transformOrigin: "58% 100%", animation: "cdTreeSway 7.5s ease-in-out infinite", opacity: 0.95 }}>
          <svg width={120} height={122} viewBox="0 0 200 204"><use href="#treeAutumnN" /></svg>
        </span>
        <span style={{ position: "absolute", top: 74, right: 6, width: 180, height: 184, transformOrigin: "58% 100%", animation: "cdTreeSway 6s ease-in-out infinite" }}>
          <svg width={180} height={184} viewBox="0 0 200 204">
            <SceneTree id="treeAutumnN" trunk="#4A3428" canopy={N_AUTUMN_CANOPY} twinkle={N_AUTUMN_TWINKLE} />
          </svg>
        </span>
        {N_REEDS.map((r, i) => (
          <span
            key={i}
            style={{
              position: "absolute", top: r.top, left: r.left, right: r.right, width: 26, height: r.h,
              transformOrigin: "50% 100%", animation: `${r.soft ? "cdReedSoft" : "cdReed"} 3.6s ease-in-out infinite`,
            }}
          >
            <svg width={26} height={r.h} viewBox="0 0 26 70">
              <path d={i % 2 ? "M13 70 Q14 34 12 12" : "M13 70 Q12 34 14 12"} stroke={r.dark ? "#5C4A30" : "#6B5638"} strokeWidth={2.5} fill="none" strokeLinecap="round" />
              <ellipse cx={i % 2 ? 12 : 14} cy={12} rx={4.5} ry={11} fill={r.ear} />
              {r.side === "l" && <path d="M13 46 q-8 -4 -11 -12" stroke="#6B5638" strokeWidth={2} fill="none" strokeLinecap="round" />}
              {r.side === "r" && <path d="M13 48 q8 -4 11 -12" stroke="#6B5638" strokeWidth={2} fill="none" strokeLinecap="round" />}
            </svg>
          </span>
        ))}
        <Firefly top={190} left={74} s={5} sp="4.8s" />
        <Firefly top={214} left={96} s={4} sp="5.6s" delay="1.7s" soft />
      </SceneCanvas>
      <span style={{ position: "absolute", top: 44, left: 0, right: 0, bottom: 0, overflow: "hidden", display: "block", pointerEvents: "none" }}>
        {N_MAPLES.map((lf, i) => (
          <span
            key={i}
            style={{
              position: "absolute", top: 0, left: `${lf.l}%`, width: lf.w, height: lf.h,
              borderRadius: "65% 35% 60% 40%", background: lf.c,
              animation: `cdLeafBig ${lf.sp}s ease-in infinite`, animationDelay: `-${lf.d}s`,
            }}
          />
        ))}
      </span>
    </>
  );
}

// ── 설날 밤(4e) — 불 켜진 한옥 + 널뛰기(연날리기 금지 — 핸드오프 확정) ────────────────

export function NightSeolScene({ scale }: SceneProps) {
  return (
    <>
      <SceneBand scale={scale} vbH={240}>
        <path d="M0 196 Q110 184 220 192 T400 188 L400 240 L0 240 Z" fill="rgba(186,198,232,0.92)" />
      </SceneBand>
      <SceneCanvas scale={scale}>
        <MoonHalo top={-16} right={-12} s={130} alpha={0.16} />
        <Moon top={16} right={26} s={40} />
        <NightStars
          stars={[
            { top: 36, right: 120, s: 2.5, sp: "2.9s", bright: true },
            { top: 14, right: 210, s: 2, sp: "3.5s", delay: "1.2s" },
            { top: 78, right: 70, s: 2, sp: "3.1s", delay: "0.5s" },
            { top: 52, right: 250, s: 2.5, sp: "3.7s", delay: "1.9s", bright: true },
            { top: 96, right: 170, s: 2, sp: "2.7s", delay: "2.6s" },
            { top: 30, right: 160, s: 2, sp: "3.3s", delay: "0.9s", bright: true },
          ]}
        />
        <svg style={{ position: "absolute", left: 0, bottom: 0 }} width={SCENE_W} height={240} viewBox="0 0 400 240">
          <ellipse cx={296} cy={200} rx={86} ry={7} fill="rgba(20,28,60,0.3)" />
          <rect x={236} y={192} width={128} height={8} rx={2} fill="#6E6C84" />
          <rect x={244} y={152} width={112} height={40} fill="#5A4030" />
          <rect x={247} y={156} width={14} height={32} fill="#F0C468" />
          <rect x={339} y={156} width={14} height={32} fill="#F0C468" style={{ animation: "cdTwinkle 5s ease-in-out infinite", animationDelay: "1.4s" }} />
          <rect x={267} y={156} width={20} height={36} rx={1.5} fill="#F5CE7E" style={{ animation: "cdTwinkle 4s ease-in-out infinite" }} />
          <rect x={291} y={156} width={20} height={36} rx={1.5} fill="#F0C468" />
          <rect x={315} y={156} width={20} height={36} rx={1.5} fill="#F5CE7E" />
          <path d="M273 156 V192 M281 156 V192 M297 156 V192 M305 156 V192 M321 156 V192 M329 156 V192 M267 164 H335 M267 174 H335 M267 184 H335" stroke="#8A6240" strokeWidth={1.2} />
          <rect x={263} y={152} width={4} height={40} fill="#4E3520" />
          <rect x={287} y={152} width={4} height={40} fill="#4E3520" />
          <rect x={311} y={152} width={4} height={40} fill="#4E3520" />
          <rect x={335} y={152} width={4} height={40} fill="#4E3520" />
          <rect x={228} y={148} width={144} height={5} fill="#4E3520" />
          <path d="M256 102 Q300 110 344 102 C362 114 376 128 392 140 Q346 152 300 150 Q254 152 208 140 C224 128 238 114 256 102 Z" fill="#262B3E" />
          <path d="M256 93 Q300 101 344 93 L344 103 Q300 111 256 103 Z" fill="#1A1E30" />
          <rect x={250} y={89} width={12} height={15} rx={2.5} fill="#1A1E30" />
          <rect x={338} y={89} width={12} height={15} rx={2.5} fill="#1A1E30" />
          <path d="M268 104 Q256 126 242 141 M284 104 Q278 126 272 147 M300 104 V149 M316 104 Q322 126 328 147 M332 104 Q344 126 358 141" stroke="#1E2334" strokeWidth={1.8} fill="none" />
          <path d="M212 139 Q254 149 300 147 Q346 149 388 139" stroke="rgba(210,220,245,0.7)" strokeWidth={4} strokeDasharray="0.8 7.4" strokeLinecap="round" fill="none" />
          <path d="M254 91 Q300 100 346 91" stroke="#E8EDF8" strokeWidth={5} strokeLinecap="round" fill="none" opacity={0.9} />
          <ellipse cx={256} cy={87} rx={7} ry={2.5} fill="#E8EDF8" opacity={0.9} />
          <ellipse cx={344} cy={87} rx={7} ry={2.5} fill="#E8EDF8" opacity={0.9} />
          <ellipse cx={270} cy={118} rx={11} ry={3} fill="#E8EDF8" opacity={0.85} />
          <ellipse cx={322} cy={124} rx={13} ry={3.5} fill="#E8EDF8" opacity={0.85} />
          <ellipse cx={296} cy={111} rx={8} ry={2.5} fill="#E8EDF8" opacity={0.85} />
          <ellipse cx={238} cy={132} rx={9} ry={2.8} fill="#E8EDF8" opacity={0.8} />
          <ellipse cx={360} cy={130} rx={9} ry={2.8} fill="#E8EDF8" opacity={0.8} />
          <path d="M214 137 Q254 147 300 145 Q346 147 386 137" stroke="#E8EDF8" strokeWidth={4} strokeLinecap="round" fill="none" opacity={0.8} />
          {/* 홍등 — 글로우 트윙클 */}
          <line x1={242} y1={142} x2={242} y2={152} stroke="#8A6240" strokeWidth={1.6} />
          <rect x={237} y={152} width={10} height={5} rx={2} fill="#C08A2E" />
          <circle cx={242} cy={163} r={13} fill="rgba(232,93,93,0.3)" style={{ animation: "cdTwinkle 3.2s ease-in-out infinite" }} />
          <circle cx={242} cy={163} r={9} fill="#E85D5D" />
          {/* 널뛰기 — 받침(볏짚단) + 널판(cdBoard) + 소녀 2명 교대 점프(cdJumpA/B, 2.4s 동기) */}
          <ellipse cx={172} cy={191.5} rx={13} ry={4.5} fill="#8A7148" />
          <path d="M162 190 q10 -4 20 0 M164 193 q8 -3 16 0" stroke="#6B5638" strokeWidth={1} fill="none" />
          <g style={{ transformBox: "fill-box", transformOrigin: "50% 50%", animation: "cdBoard 2.4s ease-in-out infinite" }}>
            <rect x={128} y={184.5} width={88} height={4.5} rx={2} fill="#8A6240" />
            <path d="M132 186.8 h80" stroke="#6E4A2A" strokeWidth={0.8} />
          </g>
          <g style={{ animation: "cdJumpA 2.4s ease-in-out infinite" }}>
            <path d="M135 164.5 q-5 -1.2 -7.8 -5.2" stroke="#E8E0D0" strokeWidth={3.6} fill="none" strokeLinecap="round" />
            <path d="M145 164.5 q5 -1.2 7.8 -5.2" stroke="#E8E0D0" strokeWidth={3.6} fill="none" strokeLinecap="round" />
            <circle cx={126.8} cy={158.8} r={1.7} fill="#F5D5BE" />
            <circle cx={153.2} cy={158.8} r={1.7} fill="#F5D5BE" />
            <path d="M131.5 184.5 q8.5 3 17 0 l-3.6 -15.5 q-4.9 -1.8 -9.8 0 Z" fill="#B03A32" />
            <path d="M136.5 172 l-1.6 11 M143.5 172 l1.6 11 M140 172 l0 11.6" stroke="#8E2A24" strokeWidth={0.8} fill="none" />
            <path d="M134.2 169.5 q5.8 -2 11.6 0 l0 -6.4 q-5.8 -2.4 -11.6 0 Z" fill="#E8E0D0" />
            <path d="M140 165.5 q-2 1 -2.4 3.8" stroke="#B03A32" strokeWidth={1.3} fill="none" strokeLinecap="round" />
            <circle cx={140} cy={157} r={5.5} fill="#F5D5BE" />
            <path d="M134.6 155.4 q5.4 -7.2 10.8 0 l-0.9 2.2 q-4.6 -4 -9 0 Z" fill="#2F2A33" />
            <circle cx={143.6} cy={150.8} r={2} fill="#2F2A33" />
            <path d="M144 152.6 l1.4 4" stroke="#B03A32" strokeWidth={1.2} strokeLinecap="round" />
            <circle cx={138} cy={156.6} r={0.8} fill="#2F2A33" />
            <circle cx={142} cy={156.6} r={0.8} fill="#2F2A33" />
            <path d="M138.8 159.2 q1.2 1.1 2.4 0" stroke="#A05840" strokeWidth={0.8} fill="none" strokeLinecap="round" />
            <circle cx={136.4} cy={158.4} r={1} fill="rgba(240,150,150,0.4)" />
            <circle cx={143.6} cy={158.4} r={1} fill="rgba(240,150,150,0.4)" />
          </g>
          <g style={{ animation: "cdJumpB 2.4s ease-in-out infinite" }}>
            <path d="M199 164.5 q-5 -1.2 -7.8 -5.2" stroke="#C08A2E" strokeWidth={3.6} fill="none" strokeLinecap="round" />
            <path d="M209 164.5 q5 -1.2 7.8 -5.2" stroke="#C08A2E" strokeWidth={3.6} fill="none" strokeLinecap="round" />
            <circle cx={190.8} cy={158.8} r={1.7} fill="#F5D5BE" />
            <circle cx={217.2} cy={158.8} r={1.7} fill="#F5D5BE" />
            <path d="M195.5 184.5 q8.5 3 17 0 l-3.6 -15.5 q-4.9 -1.8 -9.8 0 Z" fill="#3E4C9A" />
            <path d="M200.5 172 l-1.6 11 M207.5 172 l1.6 11 M204 172 l0 11.6" stroke="#2E3A78" strokeWidth={0.8} fill="none" />
            <path d="M198.2 169.5 q5.8 -2 11.6 0 l0 -6.4 q-5.8 -2.4 -11.6 0 Z" fill="#C08A2E" />
            <path d="M204 165.5 q-2 1 -2.4 3.8" stroke="#8E5E1E" strokeWidth={1.3} fill="none" strokeLinecap="round" />
            <circle cx={204} cy={157} r={5.5} fill="#F5D5BE" />
            <path d="M198.6 155.4 q5.4 -7.2 10.8 0 l-0.9 2.2 q-4.6 -4 -9 0 Z" fill="#2F2A33" />
            <circle cx={207.6} cy={150.8} r={2} fill="#2F2A33" />
            <path d="M208 152.6 l1.4 4" stroke="#B03A32" strokeWidth={1.2} strokeLinecap="round" />
            <circle cx={202} cy={156.6} r={0.8} fill="#2F2A33" />
            <circle cx={206} cy={156.6} r={0.8} fill="#2F2A33" />
            <path d="M202.8 159.2 q1.2 1.1 2.4 0" stroke="#A05840" strokeWidth={0.8} fill="none" strokeLinecap="round" />
            <circle cx={200.4} cy={158.4} r={1} fill="rgba(240,150,150,0.4)" />
            <circle cx={207.6} cy={158.4} r={1} fill="rgba(240,150,150,0.4)" />
          </g>
          {/* 눈사람 */}
          <ellipse cx={70} cy={200} rx={26} ry={4.5} fill="rgba(20,28,60,0.3)" />
          <circle cx={70} cy={186} r={12} fill="#E8ECF8" stroke="#B8C4DE" strokeWidth={1.4} />
          <circle cx={70} cy={168} r={8.5} fill="#E8ECF8" stroke="#B8C4DE" strokeWidth={1.4} />
          <circle cx={67} cy={166} r={1.3} fill="#2A3040" />
          <circle cx={73} cy={166} r={1.3} fill="#2A3040" />
          <polygon points="70,168 79,170 70,172" fill="#C06A32" />
        </svg>
      </SceneCanvas>
      <SnowLayer tall glow top={{ top: 8, left: 0, right: 0, bottom: 0 }} />
    </>
  );
}

// ── 추석 밤(4f) — 보름달 증폭 + 떡방아 토끼 + 불 켜진 한옥 ────────────────────────────

export function NightChuseokScene({ scale }: SceneProps) {
  return (
    <>
      <SceneBand scale={scale} vbH={SCENE_H}>
        <path d="M0 232 Q110 220 220 228 T400 224 L400 286 L0 286 Z" fill="rgba(84,78,128,0.55)" />
      </SceneBand>
      <SceneCanvas scale={scale}>
        <NightStars
          stars={[
            { top: 10, right: 110, s: 2.5, sp: "2.8s", bright: true },
            { top: 44, right: 60, s: 2, sp: "3.4s", delay: "1.1s" },
            { top: 80, right: 160, s: 2, sp: "3.1s", delay: "0.4s" },
            { top: 20, right: 210, s: 2.5, sp: "3.2s", delay: "1.7s", bright: true },
            { top: 58, right: 110, s: 2, sp: "2.7s", delay: "2.3s" },
            { top: 104, right: 36, s: 2, sp: "3.6s", delay: "0.8s", bright: true },
            { top: 8, right: 60, s: 2, sp: "3s", delay: "2.9s" },
          ]}
        />
        <svg style={{ position: "absolute", inset: 0 }} width={SCENE_W} height={SCENE_H} viewBox="0 0 400 286">
          {/* 보름달 증폭 — 광륜(halo pulse) + 코어 #FFF9E4 */}
          <circle cx={100} cy={98} r={88} fill="rgba(245,206,126,0.24)" style={{ animation: "cdMoonHalo 5s ease-in-out infinite" }} />
          <circle cx={100} cy={98} r={72} fill="rgba(245,206,126,0.45)" />
          <circle cx={100} cy={98} r={54} fill="#FFF9E4" />
          <circle cx={78} cy={84} r={6} fill="rgba(228,186,110,0.42)" />
          <circle cx={118} cy={70} r={4.5} fill="rgba(228,186,110,0.38)" />
          <circle cx={66} cy={112} r={5} fill="rgba(228,186,110,0.38)" />
          <ellipse cx={86} cy={136} rx={15} ry={2.6} fill="rgba(180,150,90,0.3)" />
          <ellipse cx={114} cy={139} rx={12} ry={2.4} fill="rgba(180,150,90,0.3)" />
          {/* 떡방아 토끼 — 등쪽 통통한 몸통(rx14.5) 기울임 + 절굿공이 아크 모션 2.2s 동기 */}
          <g style={{ transformBox: "fill-box", transformOrigin: "55% 96%", animation: "cdLean 2.2s ease-in-out infinite" }}>
            <circle cx={74} cy={122} r={4.5} fill="#FFFFFF" />
            <ellipse cx={84.5} cy={118} rx={14.5} ry={16.5} fill="#FBF8F0" stroke="#D8CBA8" strokeWidth={1.2} />
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
          <path d="M103 106 h22 l-2.5 26 q-0.8 5 -8.5 5 q-7.7 0 -8.5 -5 Z" fill="#6E4A2A" />
          <path d="M104 116 h20 M105 126 h18" stroke="#523618" strokeWidth={1.2} />
          <ellipse cx={114} cy={106} rx={11} ry={3} fill="#8A6240" />
          <ellipse cx={114} cy={105} rx={7} ry={2.2} fill="#FFF8E8" />
          <g style={{ transformBox: "fill-box", transformOrigin: "30% 88%", animation: "cdPoundV 2.2s ease-in-out infinite" }}>
            <rect x={111} y={70} width={6} height={34} rx={3} fill="#A97B4F" />
            <rect x={108} y={63} width={12} height={11} rx={4} fill="#8A6240" />
            <path d="M93 108 Q103 102 112 93" stroke="#FBF8F0" strokeWidth={5} fill="none" strokeLinecap="round" />
          </g>
          {/* 감나무(실루엣 톤) */}
          <path d="M400 20 Q348 34 312 66 M366 38 Q356 56 358 72" stroke="#3E3226" strokeWidth={7} fill="none" strokeLinecap="round" />
          <ellipse cx={330} cy={52} rx={14} ry={7} fill="#2E4A3E" transform="rotate(-22 330 52)" />
          <ellipse cx={368} cy={36} rx={12} ry={6} fill="#35564A" transform="rotate(-10 368 36)" />
          <ellipse cx={298} cy={62} rx={11} ry={5.5} fill="#2E4A3E" transform="rotate(-30 298 62)" />
          <circle cx={338} cy={84} r={13} fill="#C46A2E" />
          <circle cx={306} cy={76} r={11} fill="#B85E28" />
          <circle cx={372} cy={64} r={10} fill="#C46A2E" />
          <path d="M331 74 h14 l-3 4 h-8 Z" fill="#2E4A3E" />
          <path d="M300 67 h12 l-2.5 4 h-7 Z" fill="#2E4A3E" />
          <path d="M366 56 h12 l-2.5 4 h-7 Z" fill="#2E4A3E" />
          {/* 한옥 — 불 켜진 창호 */}
          <rect x={236} y={224} width={128} height={8} rx={2} fill="#6E6C84" />
          <rect x={244} y={184} width={112} height={40} fill="#5A4030" />
          <rect x={247} y={188} width={14} height={32} fill="#C4B694" />
          <rect x={339} y={188} width={14} height={32} fill="#C4B694" />
          <rect x={267} y={188} width={20} height={36} rx={1.5} fill="#F5CE7E" style={{ animation: "cdTwinkle 4s ease-in-out infinite" }} />
          <rect x={291} y={188} width={20} height={36} rx={1.5} fill="#F0C468" />
          <rect x={315} y={188} width={20} height={36} rx={1.5} fill="#F5CE7E" style={{ animation: "cdTwinkle 5s ease-in-out infinite", animationDelay: "1.2s" }} />
          <path d="M273 188 V224 M281 188 V224 M297 188 V224 M305 188 V224 M321 188 V224 M329 188 V224 M267 196 H335 M267 206 H335 M267 216 H335" stroke="#8A6240" strokeWidth={1.2} />
          <rect x={263} y={184} width={4} height={40} fill="#4E3520" />
          <rect x={287} y={184} width={4} height={40} fill="#4E3520" />
          <rect x={311} y={184} width={4} height={40} fill="#4E3520" />
          <rect x={335} y={184} width={4} height={40} fill="#4E3520" />
          <rect x={228} y={180} width={144} height={5} fill="#4E3520" />
          <path d="M256 134 Q300 142 344 134 C362 146 376 160 392 172 Q346 184 300 182 Q254 184 208 172 C224 160 238 146 256 134 Z" fill="#232738" />
          <path d="M256 125 Q300 133 344 125 L344 135 Q300 143 256 135 Z" fill="#1C2030" />
          <rect x={250} y={121} width={12} height={15} rx={2.5} fill="#1C2030" />
          <rect x={338} y={121} width={12} height={15} rx={2.5} fill="#1C2030" />
          <path d="M268 136 Q256 158 242 173 M284 136 Q278 158 272 179 M300 136 V181 M316 136 Q322 158 328 179 M332 136 Q344 158 358 173" stroke="#1A1E30" strokeWidth={1.8} fill="none" />
          <path d="M212 171 Q254 181 300 179 Q346 181 388 171" stroke="rgba(200,205,235,0.45)" strokeWidth={4} strokeDasharray="0.8 7.4" strokeLinecap="round" fill="none" />
        </svg>
        <span style={{ position: "absolute", top: 150, left: 44, width: 130, height: 26, animation: "cdCloudA 10s ease-in-out infinite" }}>
          <span style={{ position: "absolute", top: 0, left: 0, width: 104, height: 12, borderRadius: 999, background: "rgba(150,162,205,0.38)" }} />
          <span style={{ position: "absolute", top: 13, left: 20, width: 72, height: 10, borderRadius: 999, background: "rgba(150,162,205,0.26)" }} />
        </span>
      </SceneCanvas>
      <span style={{ position: "absolute", top: 36, left: 0, right: 0, bottom: 0, overflow: "hidden", display: "block", pointerEvents: "none" }}>
        {[
          { l: 58, w: 12, h: 9, c: "rgba(142,74,48,0.85)", sp: "7.4", d: "2.2" },
          { l: 72, w: 11, h: 8, c: "rgba(156,107,58,0.8)", sp: "8.6", d: "5.1" },
          { l: 84, w: 12, h: 9, c: "rgba(126,74,46,0.85)", sp: "6.8", d: "1" },
          { l: 64, w: 10, h: 8, c: "rgba(176,112,74,0.75)", sp: "7.9", d: "3.8" },
        ].map((lf, i) => (
          <span
            key={i}
            style={{
              position: "absolute", top: 0, left: `${lf.l}%`, width: lf.w, height: lf.h,
              borderRadius: "65% 35% 60% 40%", background: lf.c,
              animation: `cdLeafBig ${lf.sp}s ease-in infinite`, animationDelay: `-${lf.d}s`,
            }}
          />
        ))}
      </span>
    </>
  );
}

// ── 크리스마스 밤(4g) — 전구 글로우 강화 + 야간 비행 산타 ─────────────────────────────

export function NightXmasScene({ scale }: SceneProps) {
  return (
    <>
      <SceneBand scale={scale} vbH={SCENE_H}>
        <path d="M0 224 Q110 212 220 220 T400 216 L400 286 L0 286 Z" fill="rgba(196,206,236,0.95)" />
      </SceneBand>
      <SceneCanvas scale={scale}>
        <MoonHalo top={-14} right={-8} s={120} alpha={0.16} />
        <Moon top={16} right={26} s={42} />
        <NightStars
          stars={[
            { top: 70, right: 120, s: 2.5, sp: "2.9s", bright: true },
            { top: 100, right: 56, s: 2, sp: "3.4s", delay: "1.3s" },
            { top: 88, right: 210, s: 2, sp: "3.1s", delay: "0.6s" },
          ]}
        />
        <svg style={{ position: "absolute", inset: 0 }} width={SCENE_W} height={SCENE_H} viewBox="0 0 400 286">
          <ellipse cx={104} cy={224} rx={60} ry={7} fill="rgba(18,26,54,0.4)" />
          <rect x={96} y={208} width={15} height={18} rx={3} fill="#5A4030" />
          <polygon points="104,140 164,210 44,210" fill="#1E5038" />
          <polygon points="104,122 152,182 56,182" fill="#255C44" />
          <polygon points="104,106 142,156 66,156" fill="#2C6A50" />
          <polygon points="104,94 130,136 78,136" fill="#33785C" />
          <path d="M50 208 Q104 197 158 208" stroke="#D8E2F5" strokeWidth={5} fill="none" strokeLinecap="round" opacity={0.8} />
          <path d="M62 180 Q104 171 146 180" stroke="#D8E2F5" strokeWidth={4} fill="none" strokeLinecap="round" opacity={0.8} />
          <path d="M72 154 Q104 147 136 154" stroke="#D8E2F5" strokeWidth={3.5} fill="none" strokeLinecap="round" opacity={0.8} />
          <path d="M66 194 Q104 208 142 194" stroke="#D8AE4A" strokeWidth={3} fill="none" />
          <path d="M77 166 Q104 177 131 166" stroke="#D8AE4A" strokeWidth={2.5} fill="none" />
          {/* 전구 8개 — 이중 원(halo r9~11 + 코어) 글로우 */}
          <circle cx={82} cy={192} r={11} fill="rgba(232,93,93,0.55)" style={{ animation: "cdTwinkle 1.8s ease-in-out infinite" }} />
          <circle cx={82} cy={192} r={4.4} fill="#FF6E66" style={{ animation: "cdTwinkle 1.8s ease-in-out infinite" }} />
          <circle cx={130} cy={190} r={11} fill="rgba(95,182,232,0.55)" style={{ animation: "cdTwinkle 2.2s ease-in-out infinite", animationDelay: "0.5s" }} />
          <circle cx={130} cy={190} r={4.4} fill="#7CC8F2" style={{ animation: "cdTwinkle 2.2s ease-in-out infinite", animationDelay: "0.5s" }} />
          <circle cx={90} cy={160} r={10} fill="rgba(242,193,78,0.55)" style={{ animation: "cdTwinkle 2s ease-in-out infinite", animationDelay: "1s" }} />
          <circle cx={90} cy={160} r={4} fill="#FFD35E" style={{ animation: "cdTwinkle 2s ease-in-out infinite", animationDelay: "1s" }} />
          <circle cx={122} cy={158} r={10} fill="rgba(232,93,93,0.55)" style={{ animation: "cdTwinkle 2.4s ease-in-out infinite", animationDelay: "0.3s" }} />
          <circle cx={122} cy={158} r={4} fill="#FF6E66" style={{ animation: "cdTwinkle 2.4s ease-in-out infinite", animationDelay: "0.3s" }} />
          <circle cx={104} cy={130} r={9.5} fill="rgba(95,182,232,0.55)" style={{ animation: "cdTwinkle 2.1s ease-in-out infinite", animationDelay: "0.9s" }} />
          <circle cx={104} cy={130} r={3.8} fill="#7CC8F2" style={{ animation: "cdTwinkle 2.1s ease-in-out infinite", animationDelay: "0.9s" }} />
          <circle cx={104} cy={202} r={9.5} fill="rgba(242,193,78,0.55)" style={{ animation: "cdTwinkle 2.3s ease-in-out infinite", animationDelay: "0.7s" }} />
          <circle cx={104} cy={202} r={3.8} fill="#FFD35E" style={{ animation: "cdTwinkle 2.3s ease-in-out infinite", animationDelay: "0.7s" }} />
          <circle cx={70} cy={196} r={9} fill="rgba(95,182,232,0.55)" style={{ animation: "cdTwinkle 1.9s ease-in-out infinite", animationDelay: "1.3s" }} />
          <circle cx={70} cy={196} r={3.6} fill="#7CC8F2" style={{ animation: "cdTwinkle 1.9s ease-in-out infinite", animationDelay: "1.3s" }} />
          <circle cx={112} cy={146} r={9} fill="rgba(232,93,93,0.55)" style={{ animation: "cdTwinkle 2.5s ease-in-out infinite", animationDelay: "1.6s" }} />
          <circle cx={112} cy={146} r={3.6} fill="#FF6E66" style={{ animation: "cdTwinkle 2.5s ease-in-out infinite", animationDelay: "1.6s" }} />
          {/* 꼭대기 별 — 이중 광륜 + 십자 광선 */}
          <circle cx={104} cy={79} r={22} fill="rgba(245,206,126,0.3)" style={{ animation: "cdTwinkle 2s ease-in-out infinite" }} />
          <circle cx={104} cy={79} r={14} fill="rgba(245,206,126,0.55)" style={{ animation: "cdTwinkle 2s ease-in-out infinite" }} />
          <path d="M104 58 V64 M104 94 V100 M86 79 H92 M116 79 H122" stroke="rgba(255,228,154,0.8)" strokeWidth={1.6} strokeLinecap="round" style={{ animation: "cdTwinkle 2s ease-in-out infinite" }} />
          <polygon points="104,66 107.5,76 117,76 109.5,82 112.5,92 104,86 95.5,92 98.5,82 90,76 100.5,76" fill="#FFE49A" style={{ animation: "cdTwinkle 2s ease-in-out infinite" }} />
          <rect x={40} y={208} width={28} height={20} rx={3} fill="#A83A30" />
          <rect x={51} y={208} width={6} height={20} fill="#D8AE4A" />
          <rect x={150} y={212} width={24} height={16} rx={3} fill="#3E4C9A" />
          <rect x={159} y={212} width={6} height={16} fill="#E8ECF8" />
          <rect x={72} y={216} width={17} height={12} rx={3} fill="#2E8A70" />
        </svg>
        <span style={{ position: "absolute", top: 150, right: 56, width: 64, height: 80, transformOrigin: "50% 100%", animation: "cdSway 3.8s ease-in-out infinite" }}>
          <svg width={64} height={80} viewBox="0 0 64 80">
            <ellipse cx={32} cy={76} rx={24} ry={4} fill="rgba(18,26,54,0.4)" />
            <circle cx={32} cy={56} r={20} fill="#F2F5FC" stroke="#B8C4DE" strokeWidth={1.5} />
            <circle cx={32} cy={26} r={14} fill="#F2F5FC" stroke="#B8C4DE" strokeWidth={1.5} />
            <rect x={22} y={6} width={20} height={10} rx={1.5} fill="#1E2434" />
            <rect x={18} y={14} width={28} height={4} rx={2} fill="#1E2434" />
            <circle cx={27} cy={24} r={1.6} fill="#1E2434" />
            <circle cx={37} cy={24} r={1.6} fill="#1E2434" />
            <polygon points="32,26 46,28 32,30" fill="#C06A32" />
            <rect x={23} y={37} width={18} height={6} rx={3} fill="#B03A32" />
            <rect x={33} y={40} width={6} height={14} rx={3} fill="#B03A32" />
            <path d="M12 50 L0 40 M52 50 L64 38" stroke="#5A4030" strokeWidth={3} strokeLinecap="round" />
            <circle cx={32} cy={50} r={1.9} fill="#1E2434" />
            <circle cx={32} cy={58} r={1.9} fill="#1E2434" />
          </svg>
        </span>
        <span style={{ position: "absolute", top: 16, left: 0, width: 150, height: 48, animation: "cdSleigh 13s linear infinite", filter: "drop-shadow(0 4px 6px rgba(6,10,26,0.4))" }}>
          <svg width={150} height={48} viewBox="0 0 150 48">
            <path d="M4 40 q-3 6 5 8 h32" stroke="#C09A3E" strokeWidth={2.5} fill="none" strokeLinecap="round" />
            <path d="M10 22 q-9 10 3 17 h28 q11 0 12 -11 l-1 -9 h-26 q-10 0 -16 3 z" fill="#8E3226" />
            <circle cx={18} cy={18} r={8} fill="#5A4030" />
            <circle cx={36} cy={12} r={5} fill="#E8C4AC" />
            <polygon points="30,10 36,0 42,10" fill="#B03A32" />
            <circle cx={42} cy={1.5} r={2} fill="#F2F5FC" />
            <rect x={30} y={10} width={12} height={3} rx={1.5} fill="#F2F5FC" />
            <rect x={29} y={15} width={15} height={11} rx={4} fill="#B03A32" />
            <path d="M54 26 L88 24 L120 22" stroke="#4A3428" strokeWidth={1.5} fill="none" />
            <ellipse cx={94} cy={30} rx={12} ry={6.5} fill="#6E4A32" />
            <path d="M88 36 v8 M100 36 v8" stroke="#4A3428" strokeWidth={2.4} strokeLinecap="round" />
            <circle cx={106} cy={21} r={4.5} fill="#6E4A32" />
            <path d="M106 17 q-2 -6 -7 -8 M107 17 q3 -6 8 -7" stroke="#4A3428" strokeWidth={1.8} fill="none" strokeLinecap="round" />
            <ellipse cx={124} cy={28} rx={12} ry={6.5} fill="#7E5A3C" />
            <path d="M118 34 v8 M130 34 v8" stroke="#4A3428" strokeWidth={2.4} strokeLinecap="round" />
            <circle cx={136} cy={19} r={4.5} fill="#7E5A3C" />
            <path d="M136 15 q-2 -6 -7 -8 M137 15 q3 -6 8 -7" stroke="#4A3428" strokeWidth={1.8} fill="none" strokeLinecap="round" />
            <circle cx={140} cy={20} r={4.5} fill="rgba(232,67,58,0.4)" style={{ animation: "cdTwinkle 1.2s ease-in-out infinite" }} />
            <circle cx={140} cy={20} r={2} fill="#E8433A" style={{ animation: "cdTwinkle 1.2s ease-in-out infinite" }} />
          </svg>
        </span>
      </SceneCanvas>
      <SnowLayer tall glow top={{ top: 8, left: 0, right: 0, bottom: 0 }} />
    </>
  );
}

// ── 여름휴가 밤(3c) — 달빛 물결 + 백사장 모닥불 + 랜턴 요트 ───────────────────────────

export function NightSummerScene({ scale }: SceneProps) {
  return (
    <>
      <SceneBand scale={scale} vbH={SCENE_H}>
        <defs>
          <linearGradient id="wSeaGradN" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#27477A" />
            <stop offset="100%" stopColor="#152A4E" />
          </linearGradient>
        </defs>
        <rect x={0} y={156} width={400} height={74} fill="url(#wSeaGradN)" />
        <rect x={0} y={156} width={400} height={2.5} fill="rgba(190,208,245,0.3)" />
        <path d="M0 230 Q100 216 200 226 T400 222 L400 286 L0 286 Z" fill="#4A4238" />
        <path d="M0 230 Q100 216 200 226 T400 222" stroke="rgba(210,222,250,0.22)" strokeWidth={3} fill="none" />
      </SceneBand>
      <SceneCanvas scale={scale}>
        <MoonHalo top={-26} right={-20} s={150} alpha={0.22} sp="4.5s" />
        <Moon
          top={18} right={28} s={46} glow="0 0 22px 5px rgba(240,230,175,0.35)"
          craters={[{ t: 10, l: 12, s: 8, o: 0.5 }, { t: 24, l: 26, s: 5, o: 0.42 }]}
        />
        <NightStars
          stars={[
            { top: 30, right: 110, s: 2.5, sp: "2.8s", bright: true },
            { top: 64, right: 156, s: 2, sp: "3.4s", delay: "0.9s" },
            { top: 14, right: 196, s: 2.5, sp: "3.1s", delay: "1.5s", bright: true },
            { top: 92, right: 70, s: 2, sp: "2.6s", delay: "0.4s" },
          ]}
        />
        <SparkleStar top={48} right={236} s={11} sp="3.6s" delay="2s" fill="#E8EFFF" />
        {/* 달빛 물결 반사 기둥 + 트윙클 글린트 — 야자수·파라솔 전경보다 뒤 */}
        <span style={{ position: "absolute", top: 160, right: 34, width: 30, height: 64, background: "linear-gradient(180deg,rgba(255,236,180,0.2),rgba(255,236,180,0.05))", borderRadius: 8, filter: "blur(2px)" }} />
        <span style={{ position: "absolute", top: 168, right: 40, width: 15, height: 3, borderRadius: 999, background: "rgba(255,238,190,0.75)", animation: "cdTwinkle 2.2s ease-in-out infinite" }} />
        <span style={{ position: "absolute", top: 182, right: 48, width: 11, height: 2.6, borderRadius: 999, background: "rgba(255,238,190,0.6)", animation: "cdTwinkle 2.8s ease-in-out infinite", animationDelay: "0.7s" }} />
        <span style={{ position: "absolute", top: 196, right: 36, width: 14, height: 3, borderRadius: 999, background: "rgba(255,238,190,0.68)", animation: "cdTwinkle 2.5s ease-in-out infinite", animationDelay: "1.3s" }} />
        <span style={{ position: "absolute", top: 210, right: 46, width: 10, height: 2.4, borderRadius: 999, background: "rgba(255,238,190,0.55)", animation: "cdTwinkle 3s ease-in-out infinite", animationDelay: "1.9s" }} />
        {/* 랜턴 요트 — 요트·물결은 전경(야자수·파라솔) 뒤로 통과한다 */}
        <span style={{ position: "absolute", top: 148, left: 0, width: 96, height: 56, animation: "cdSail 26s linear infinite" }}>
          <span style={{ position: "absolute", inset: 0, display: "block", animation: "cdBob 4s ease-in-out infinite" }}>
            <svg width={96} height={56} viewBox="0 0 96 56">
              <path d="M4 44 q18 6 40 4 M0 50 q26 8 56 4" stroke="rgba(200,216,250,0.28)" strokeWidth={3} fill="none" strokeLinecap="round" />
              <line x1={52} y1={8} x2={52} y2={36} stroke="#2E2838" strokeWidth={2} />
              <polygon points="52,8 52,36 32,36" fill="#8E97B8" />
              <polygon points="55,12 55,36 72,36" fill="#6E7796" />
              <path d="M28 38 q22 10 46 0 l-6 10 h-34 z" fill="#332A3E" />
              <circle cx={53} cy={6} r={2.2} fill="#FFD98A" style={{ animation: "cdTwinkle 1.6s ease-in-out infinite" }} />
            </svg>
          </span>
        </span>
        <svg style={{ position: "absolute", inset: 0 }} width={SCENE_W} height={SCENE_H} viewBox="0 0 400 286">
          <ellipse cx={300} cy={236} rx={36} ry={5} fill="rgba(15,22,42,0.35)" />
          <path d="M296 232 C288 192 300 162 286 128" stroke="#3A3040" strokeWidth={9} fill="none" strokeLinecap="round" />
          <g transform="rotate(-10 352 186)">
            <path d="M320 188 Q352 150 384 188 Z" fill="#3A3550" />
            <path d="M332 186 Q346 156 352 187 Z" fill="#59547A" opacity={0.9} />
            <path d="M358 187 Q364 156 376 185 Z" fill="#59547A" opacity={0.9} />
            {/* 꼭지 — 주간과 같은 보정: 갓 곡선 정점(y≈169)에 붙인다. */}
            <line x1={352} y1={172} x2={352} y2={163} stroke="#2E2838" strokeWidth={3} strokeLinecap="round" />
          </g>
          <line x1={352} y1={186} x2={358} y2={232} stroke="#2E2838" strokeWidth={3.5} strokeLinecap="round" />
        </svg>
        {/* 야자수 잎(실루엣 톤) */}
        <span style={{ position: "absolute", top: 70, left: 222, width: 130, height: 74, transformOrigin: "49% 78%", animation: "cdSway 5s ease-in-out infinite" }}>
          <svg width={130} height={74} viewBox="0 0 130 74">
            <path d="M64 58 Q30 40 4 48 Q34 56 66 66 Z" fill="#28495A" />
            <path d="M64 58 Q42 22 16 16 Q46 36 66 62 Z" fill="#2E5568" />
            <path d="M64 58 Q64 18 48 4 Q72 28 70 60 Z" fill="#224050" />
            <path d="M64 58 Q90 20 116 16 Q90 38 68 62 Z" fill="#2E5568" />
            <path d="M64 58 Q102 40 126 50 Q96 58 64 68 Z" fill="#28495A" />
            <circle cx={62} cy={66} r={5} fill="#3A2E24" />
            <circle cx={73} cy={62} r={5} fill="#33271E" />
          </svg>
        </span>
        {/* 백사장 모닥불 — 장작 + 불꽃(cdFlame) + 불티(cdSpark) + 주황 글로우 */}
        <span style={{ position: "absolute", top: 200, left: 216, width: 44, height: 52 }}>
          <span style={{ position: "absolute", bottom: -6, left: -24, width: 90, height: 56, borderRadius: 999, background: "radial-gradient(circle,rgba(255,170,80,0.32),transparent 66%)", animation: "cdMoonHalo 1.8s ease-in-out infinite" }} />
          <span style={{ position: "absolute", bottom: 8, left: 9, width: 24, height: 8, borderRadius: 4, background: "#4A3428", transform: "rotate(16deg)" }} />
          <span style={{ position: "absolute", bottom: 8, left: 9, width: 24, height: 8, borderRadius: 4, background: "#3E2B20", transform: "rotate(-16deg)" }} />
          <span style={{ position: "absolute", bottom: 13, left: 12, width: 17, height: 25, borderRadius: "50% 50% 50% 50%/62% 62% 38% 38%", background: "linear-gradient(180deg,#FFD98A,#F2933E 68%,#D86A2E)", transformOrigin: "50% 100%", animation: "cdFlame 0.9s ease-in-out infinite" }} />
          <span style={{ position: "absolute", bottom: 13, left: 16, width: 9, height: 14, borderRadius: "50% 50% 50% 50%/62% 62% 38% 38%", background: "#FFF2C4", transformOrigin: "50% 100%", animation: "cdFlame 0.7s ease-in-out infinite", animationDelay: "0.2s" }} />
          <span style={{ position: "absolute", bottom: 36, left: 16, width: 2.5, height: 2.5, borderRadius: 999, background: "#FFCE7A", animation: "cdSpark 1.7s linear infinite" }} />
          <span style={{ position: "absolute", bottom: 34, left: 24, width: 2, height: 2, borderRadius: 999, background: "#FFB95C", animation: "cdSpark 2.1s linear infinite", animationDelay: "0.8s" }} />
        </span>
      </SceneCanvas>
      {/* 파도 거품(어두운 톤) — 카드 전폭. 수면 위치는 씬 좌표(top 196/286 부근) × 스케일로 환산 */}
      <span style={{ position: "absolute", bottom: (SCENE_H - 236) * scale, left: 0, right: 0, height: 40, overflow: "hidden", display: "block", pointerEvents: "none" }}>
        <span style={{ position: "absolute", bottom: 16, left: "-6%", width: "120%", height: 13, borderRadius: 999, background: "rgba(190,208,245,0.14)", animation: "cdWave 6s ease-in-out infinite" }} />
        <span style={{ position: "absolute", bottom: 2, left: "-4%", width: "130%", height: 12, borderRadius: 999, background: "rgba(190,208,245,0.1)", animation: "cdWave 8s ease-in-out infinite reverse" }} />
      </span>
    </>
  );
}

export const NIGHT_SCENES = {
  맑음: NightSunnyScene,
  흐림: NightCloudyScene,
  비: NightRainScene,
  눈: NightSnowScene,
  봄: NightSpringScene,
  가을: NightAutumnScene,
  여름휴가: NightSummerScene,
  설날: NightSeolScene,
  추석: NightChuseokScene,
  크리스마스: NightXmasScene,
} as const;
