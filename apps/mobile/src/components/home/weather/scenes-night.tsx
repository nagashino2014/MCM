/**
 * 야간 씬 10종 — Soft Glass Ink 핸드오프 야간 확정안(웹 weather-night.tsx)의 RN 이식.
 *
 * 야간 공통 규칙: ① 밤하늘(딥 네이비 + 트윙클 별 + 달·광륜) ② 야간 광원이 주인공
 * (유성·반딧불·모닥불·달빛 물결·번개·창호 불빛·전구 글로우·널뛰기) ③ 텍스트/스크림 반전(위젯 본체).
 *
 * 좌표는 시안의 400×286 캔버스 기준. 모바일 카드는 캔버스 위쪽 29px 를 잘라내므로
 * 지면(bottom 앵커) 씬의 하늘 오브젝트(달·별)는 +16 내려 배치한다(주간 씬의 연·감나무 보정과 같은 규칙).
 */
import { View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, Polygon, Polyline, RadialGradient, Rect, Stop } from "react-native-svg";

import { useLinearLoop, usePingPong } from "./anim";
import {
  Cloud,
  Drift,
  Firefly,
  Flame,
  Flash,
  Moon,
  MoonHalo,
  NightStar,
  RainLayer,
  SceneBand,
  SceneCanvas,
  SeesawBoard,
  SeesawJumper,
  ShootingStar,
  SnowLayer,
  Spark,
  SparkleStar,
  Sway,
  Twinkle,
  TwinkleRect,
  type SceneProps,
} from "./parts";
import { SCENE_H, SCENE_W } from "./rules";
import { TreeSprite, type Canopy, type TwinkleDot } from "./scenes-season";

/** 지면(bottom 앵커) 씬 하늘 오브젝트의 하향 보정 — 카드가 캔버스 위 29px 를 잘라내는 몫. */
const SKY = 16;

// 야간 구름 그라데이션(달빛 림라이트 톤)
const N_CLOUD: [string, string] = ["#55628E", "#3A4569"];
const N_CLOUD2: [string, string] = ["#5E6C9A", "#414D74"];
const N_CLOUD_DIM: [string, string] = ["#48547E", "#333E60"];
const N_CLOUD_DIM2: [string, string] = ["#505D88", "#3A4569"];
const N_CLOUD_DARK: [string, string] = ["#3A4569", "#2C3654"];
const N_CLOUD_DARK2: [string, string] = ["#414D74", "#333E60"];

export function NightSunnyScene(p: SceneProps) {
  return (
    <SceneCanvas {...p} anchor="topRight">
      <MoonHalo top={-32} right={-28} s={190} alpha={0.2} duration={4500} />
      <Moon
        top={20}
        right={26}
        s={54}
        craters={[
          { t: 12, l: 14, s: 9, o: 0.5 },
          { t: 28, l: 30, s: 6, o: 0.42 },
          { t: 31, l: 12, s: 4.5, o: 0.38 },
        ]}
      />
      <NightStar top={26} right={118} s={3} duration={2600} bright />
      <NightStar top={58} right={160} s={2} duration={3400} delay={700} />
      <NightStar top={14} right={200} s={2.5} duration={3000} delay={1400} bright />
      <NightStar top={92} right={36} s={2} duration={2800} delay={400} />
      <NightStar top={110} right={120} s={3} duration={3600} delay={1900} bright />
      <SparkleStar top={48} right={96} s={14} duration={3200} delay={1000} />
      <SparkleStar top={128} right={190} s={10} duration={4000} delay={2300} fill="#D8E2FA" />
      <ShootingStar top={34} right={250} />
      <Cloud
        id="ns1"
        style={{ top: 112, right: 64 }}
        w={104}
        h={38}
        base={{ w: 104, h: 26, c: N_CLOUD }}
        puffs={[
          { b: 10, l: 16, s: 35, c: N_CLOUD2 },
          { b: 10, l: 48, s: 27, c: N_CLOUD },
        ]}
        drift={{ from: -8, to: 12, duration: 9000 }}
      />
      <Cloud
        id="ns2"
        style={{ top: 168, right: 16 }}
        w={78}
        h={28}
        opacity={0.7}
        base={{ w: 78, h: 19, c: N_CLOUD_DIM }}
        puffs={[{ b: 8, l: 13, s: 25, c: N_CLOUD_DIM2 }]}
        drift={{ from: 10, to: -9, duration: 12000 }}
      />
    </SceneCanvas>
  );
}

export function NightCloudyScene(p: SceneProps) {
  return (
    <SceneCanvas {...p} anchor="topRight">
      <NightStar top={96} right={212} s={2.5} duration={3000} bright />
      <NightStar top={150} right={150} s={2} duration={3600} delay={1200} />
      <NightStar top={170} right={250} s={2} duration={2700} delay={500} />
      <Cloud
        id="nc1"
        style={{ top: 48, right: 118 }}
        w={108}
        h={42}
        opacity={0.75}
        base={{ w: 108, h: 28, c: N_CLOUD_DARK }}
        puffs={[
          { b: 11, l: 16, s: 38, c: N_CLOUD_DARK2 },
          { b: 11, l: 50, s: 28, c: N_CLOUD_DARK },
        ]}
        drift={{ from: 10, to: -9, duration: 11000 }}
      />
      <MoonHalo top={-14} right={18} s={130} alpha={0.14} />
      <Moon top={22} right={62} s={40} />
      <Cloud
        id="nc2"
        style={{ top: 34, right: 14 }}
        w={136}
        h={54}
        base={{ w: 136, h: 34, c: N_CLOUD }}
        puffs={[
          { b: 14, l: 17, s: 48, c: N_CLOUD2 },
          { b: 14, l: 60, s: 37, c: N_CLOUD },
        ]}
        drift={{ from: -8, to: 12, duration: 8000 }}
      />
      <Cloud
        id="nc3"
        style={{ top: 126, right: 36 }}
        w={96}
        h={30}
        opacity={0.6}
        base={{ w: 96, h: 20, c: N_CLOUD_DIM }}
        puffs={[{ b: 8, l: 14, s: 28, c: N_CLOUD_DIM2 }]}
        drift={{ from: 12, to: -8, duration: 13000 }}
      />
      {/* 안개 띠(cdHaze) — 야간 톤 */}
      <Drift from={0} to={8} duration={6000} style={{ top: 112, right: 150, width: 80, height: 11, opacity: 0.7 }}>
        <Svg width={80} height={11}>
          <Defs>
            <LinearGradient id="nHazeG" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#6E7DAF" stopOpacity={0} />
              <Stop offset="0.5" stopColor="#6E7DAF" stopOpacity={0.5} />
              <Stop offset="1" stopColor="#6E7DAF" stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={80} height={11} rx={5.5} fill="url(#nHazeG)" />
        </Svg>
      </Drift>
    </SceneCanvas>
  );
}

export function NightRainScene(p: SceneProps) {
  return (
    <SceneCanvas {...p} anchor="topRight">
      <NightStar top={120} right={230} s={2} duration={3400} />
      <NightStar top={12} right={250} s={2.5} duration={2800} delay={1000} bright />
      {/* 원거리 번개 — 확산광 + 낙뢰 폴리라인이 같은 위상(7s)으로 점멸 */}
      <Flash style={{ top: 26, right: 120, width: 150, height: 130 }}>
        <Svg width={150} height={130}>
          <Defs>
            <LinearGradient id="boltGlowL" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#AAC3FF" stopOpacity={0.4} />
              <Stop offset="1" stopColor="#AAC3FF" stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Ellipse cx={75} cy={65} rx={75} ry={65} fill="url(#boltGlowL)" />
        </Svg>
      </Flash>
      <Flash style={{ top: 56, right: 172, width: 44, height: 96 }}>
        <Svg width={44} height={96} viewBox="0 0 60 110">
          <Polyline points="38,0 22,44 34,44 16,100" stroke="#DCE8FF" strokeWidth={3.4} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      </Flash>
      <RainLayer
        style={{ top: 52, right: 8, width: 225, height: 130, transform: [{ rotate: "7deg" }] }}
        color="rgba(140,170,240,0.62)"
      />
      <Cloud
        id="nr1"
        style={{ top: 38, right: 126 }}
        w={96}
        h={34}
        opacity={0.85}
        base={{ w: 96, h: 24, c: N_CLOUD_DARK }}
        puffs={[{ b: 9, l: 14, s: 33, c: N_CLOUD_DARK2 }]}
        drift={{ from: 10, to: -9, duration: 10000 }}
      />
      <Cloud
        id="nr2"
        style={{ top: 10, right: 18 }}
        w={128}
        h={50}
        base={{ w: 128, h: 31, c: N_CLOUD }}
        puffs={[
          { b: 13, l: 16, s: 45, c: N_CLOUD2 },
          { b: 13, l: 57, s: 34, c: N_CLOUD },
        ]}
        drift={{ from: -8, to: 12, duration: 8000 }}
      />
    </SceneCanvas>
  );
}

export function NightSnowScene(p: SceneProps) {
  // 눈 밤은 달이 없다(핸드오프) — 발광 눈송이가 광원.
  return (
    <SceneCanvas {...p} anchor="topRight">
      <NightStar top={110} right={250} s={2.5} duration={3000} bright />
      <NightStar top={150} right={170} s={2} duration={3600} delay={1400} />
      <NightStar top={16} right={250} s={2} duration={2600} delay={600} />
      <NightStar top={22} right={160} s={2.5} duration={3300} delay={2000} bright />
      <SnowLayer glow style={{ top: 52, right: 8, width: 235, height: 130 }} />
      <Cloud
        id="nn1"
        style={{ top: 38, right: 124 }}
        w={92}
        h={32}
        opacity={0.85}
        base={{ w: 92, h: 23, c: N_CLOUD }}
        puffs={[{ b: 8, l: 14, s: 31, c: N_CLOUD2 }]}
        drift={{ from: 10, to: -9, duration: 11000 }}
      />
      <Cloud
        id="nn2"
        style={{ top: 9, right: 20 }}
        w={126}
        h={50}
        base={{ w: 126, h: 31, c: ["#8E99BE", "#55628E"] }}
        puffs={[
          { b: 13, l: 15, s: 45, c: ["#98A4C8", "#5E6C9A"] },
          { b: 13, l: 56, s: 34, c: ["#8E99BE", "#55628E"] },
        ]}
        drift={{ from: -8, to: 12, duration: 9000 }}
      />
    </SceneCanvas>
  );
}

// ── 봄 밤 — 달빛 벚나무 + 반딧불 ────────────────────────────────────────────────

const N_SPRING_CANOPY: Canopy[] = [
  { cx: 52, cy: 78, r: 17, f: "#A06B88" }, { cx: 78, cy: 58, r: 21, f: "#B37E98" }, { cx: 108, cy: 46, r: 24, f: "#A06B88" },
  { cx: 140, cy: 52, r: 22, f: "#B37E98" }, { cx: 164, cy: 68, r: 19, f: "#A06B88" }, { cx: 178, cy: 92, r: 16, f: "#8E5E78" },
  { cx: 96, cy: 74, r: 18, f: "#8E5E78" }, { cx: 126, cy: 70, r: 19, f: "#B37E98" }, { cx: 152, cy: 86, r: 17, f: "#A06B88" },
  { cx: 66, cy: 96, r: 15, f: "#B37E98" }, { cx: 88, cy: 92, r: 14, f: "#A06B88" }, { cx: 118, cy: 88, r: 16, f: "#8E5E78" },
  { cx: 142, cy: 104, r: 14, f: "#B37E98" }, { cx: 168, cy: 114, r: 12, f: "#8E5E78" }, { cx: 104, cy: 60, r: 15, f: "#B37E98" },
  { cx: 58, cy: 60, r: 13, f: "#A06B88" }, { cx: 150, cy: 138, r: 13, f: "#A06B88" }, { cx: 162, cy: 146, r: 10, f: "#B37E98" },
  { cx: 144, cy: 150, r: 9, f: "#8E5E78" }, { cx: 100, cy: 50, r: 9, f: "#C795AC" }, { cx: 134, cy: 58, r: 8, f: "#C795AC" },
  { cx: 72, cy: 66, r: 7, f: "#C795AC" }, { cx: 158, cy: 76, r: 7, f: "#C795AC" }, { cx: 90, cy: 80, r: 6, f: "#C795AC" },
];
const N_SPRING_TWINKLE: TwinkleDot[] = [
  { cx: 112, cy: 66, r: 3.2, f: "#E8C2D2", sp: 3000 },
  { cx: 146, cy: 72, r: 3.2, f: "#E8C2D2", sp: 3600, delay: 800 },
  { cx: 74, cy: 82, r: 2.8, f: "#E8C2D2", sp: 3200, delay: 1600 },
  { cx: 170, cy: 96, r: 2.8, f: "#E8C2D2", sp: 3400, delay: 2200 },
];

/** 야간 꽃잎/낙엽 — 시안 좌표·색 고정(웹 N_PETALS/N_MAPLES 와 동일). */
function NightFlutterLayer({
  items,
  keys,
}: {
  items: { l: number; w: number; h: number; c: string; dur: number; off: number; radius: string }[];
  keys: number[][];
}) {
  // parts.tsx 의 Flutter 는 비공개라 같은 보간을 로컬로 구성한다 — 주기 4개 공유.
  const loops = [useLinearLoop(items[0]?.dur ?? 7000), useLinearLoop(items[1]?.dur ?? 8000), useLinearLoop(items[2]?.dur ?? 6600), useLinearLoop(items[3]?.dur ?? 7800)];
  return (
    <>
      {items.map((it, i) => (
        <NightFlutterItem key={i} p={loops[i % loops.length]} it={it} keys={keys} />
      ))}
    </>
  );
}

function NightFlutterItem({
  p,
  it,
  keys,
}: {
  p: { value: number };
  it: { l: number; w: number; h: number; c: string; off: number; radius: string };
  keys: number[][];
}) {
  const st = useAnimatedStyle(() => {
    let t = p.value + it.off;
    t = t - Math.floor(t);
    let x = 0;
    let y = 0;
    let rot = 0;
    for (let i = 1; i < keys.length; i += 1) {
      if (t <= keys[i][0] || i === keys.length - 1) {
        const r = (t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
        x = keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * r;
        y = keys[i - 1][2] + (keys[i][2] - keys[i - 1][2]) * r;
        rot = keys[i - 1][3] + (keys[i][3] - keys[i - 1][3]) * r;
        break;
      }
    }
    return {
      transform: [{ translateX: x }, { translateY: y }, { rotate: `${rot}deg` }],
      opacity: t < 0.1 ? t * 10 : t > 0.8 ? (1 - t) * 5 : 1,
    };
  });
  const rad = it.radius.split(" ").map(Number);
  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          top: 0,
          left: `${it.l}%`,
          width: it.w,
          height: it.h,
          backgroundColor: it.c,
          borderTopLeftRadius: rad[0],
          borderTopRightRadius: rad[1],
          borderBottomRightRadius: rad[2],
          borderBottomLeftRadius: rad[3],
        },
        st,
      ]}
    />
  );
}

const PETAL_KEYS = [
  [0, 0, -10, 0],
  [0.4, -16, 64, 80],
  [0.7, 8, 130, 160],
  [1, -12, 196, 240],
];
const LEAF_KEYS = [
  [0, 0, -14, 0],
  [0.45, -20, 86, 120],
  [0.8, 8, 158, 200],
  [1, -14, 208, 280],
];

const N_PETALS = [
  { l: 52, w: 9, h: 8, c: "rgba(214,160,184,0.85)", dur: 7200, off: 0.29, radius: "4 3 4 3" },
  { l: 64, w: 8, h: 7, c: "rgba(199,149,172,0.8)", dur: 8400, off: 0.67, radius: "4 3 4 3" },
  { l: 78, w: 10, h: 8, c: "rgba(226,176,196,0.85)", dur: 6600, off: 0.14, radius: "4 3 4 3" },
  { l: 88, w: 8, h: 7, c: "rgba(214,160,184,0.75)", dur: 7800, off: 0.54, radius: "4 3 4 3" },
  { l: 70, w: 7, h: 6, c: "rgba(199,149,172,0.7)", dur: 9000, off: 0.76, radius: "4 3 4 3" },
  { l: 58, w: 8, h: 7, c: "rgba(226,176,196,0.8)", dur: 7500, off: 0.44, radius: "4 3 4 3" },
];

export function NightSpringScene(p: SceneProps) {
  return (
    <>
      <SceneBand w={p.w} scale={p.scale} vbH={240}>
        <Path d="M0 186 Q100 162 210 178 T400 172 L400 240 L0 240 Z" fill="rgba(56,78,92,0.5)" />
        <Path d="M0 208 Q120 196 240 204 T400 200 L400 240 L0 240 Z" fill="rgba(68,94,104,0.8)" />
        <Ellipse cx={240} cy={214} rx={5} ry={2.4} fill="rgba(196,140,164,0.55)" />
        <Ellipse cx={268} cy={220} rx={4.5} ry={2.2} fill="rgba(184,128,152,0.5)" />
        <Ellipse cx={312} cy={216} rx={5} ry={2.4} fill="rgba(205,152,175,0.55)" />
        <Ellipse cx={204} cy={218} rx={4} ry={2} fill="rgba(196,140,164,0.45)" />
        <Path
          d="M64 208 q2 -9 6 -11 M76 210 q1 -8 5 -10 M158 206 q2 -9 6 -11 M170 208 q2 -8 5 -10"
          stroke="#4E7460"
          strokeWidth={2.2}
          fill="none"
          strokeLinecap="round"
        />
      </SceneBand>
      <SceneCanvas {...p}>
        <MoonHalo top={SKY} right={110} s={130} alpha={0.18} />
        <Moon top={38 + SKY} right={150} s={36} />
        <NightStar top={30 + SKY} right={150} s={2.5} duration={3000} bright />
        <NightStar top={64 + SKY} right={262} s={2} duration={3500} delay={1100} />
        <NightStar top={12 + SKY} right={118} s={2.5} duration={2700} delay={500} bright />
        <NightStar top={44 + SKY} right={60} s={2} duration={3800} delay={1800} />
        <TreeSprite
          size={[120, 122]}
          style={{ top: 132, right: 116 }}
          duration={7200}
          opacity={0.95}
          trunk="#4E3A50"
          canopy={N_SPRING_CANOPY}
          twinkle={N_SPRING_TWINKLE}
        />
        <TreeSprite
          size={[180, 184]}
          style={{ top: 74, right: 6 }}
          duration={6000}
          trunk="#4E3A50"
          canopy={N_SPRING_CANOPY}
          twinkle={N_SPRING_TWINKLE}
        />
        <Firefly top={186} left={74} s={5} duration={4600} />
        <Firefly top={206} left={128} s={4} duration={5400} delay={1300} />
        <Firefly top={170} left={180} s={4} duration={4000} delay={2400} soft />
        <Firefly top={222} left={236} s={5} duration={5000} delay={700} />
        <Firefly top={196} left={308} s={4} duration={4400} delay={3100} soft />
      </SceneCanvas>
      <View pointerEvents="none" style={{ position: "absolute", top: 44, left: 0, right: 0, bottom: 0, overflow: "hidden" }}>
        <NightFlutterLayer items={N_PETALS} keys={PETAL_KEYS} />
      </View>
    </>
  );
}

// ── 가을 밤 — 달빛 단풍 + 갈대 실루엣 + 반딧불 ─────────────────────────────────────

const N_AUTUMN_CANOPY: Canopy[] = [
  { cx: 52, cy: 78, r: 17, f: "#9C6B3A" }, { cx: 78, cy: 58, r: 21, f: "#8E5636" }, { cx: 108, cy: 46, r: 24, f: "#7E4A2E" },
  { cx: 140, cy: 52, r: 22, f: "#8E5636" }, { cx: 164, cy: 68, r: 19, f: "#6E3E28" }, { cx: 178, cy: 92, r: 16, f: "#7E4A2E" },
  { cx: 96, cy: 74, r: 18, f: "#6E3E28" }, { cx: 126, cy: 70, r: 19, f: "#9C6B3A" }, { cx: 152, cy: 86, r: 17, f: "#8E5636" },
  { cx: 66, cy: 96, r: 15, f: "#7E4A2E" }, { cx: 88, cy: 92, r: 14, f: "#8E5636" }, { cx: 118, cy: 88, r: 16, f: "#6E3E28" },
  { cx: 142, cy: 104, r: 14, f: "#9C6B3A" }, { cx: 168, cy: 114, r: 12, f: "#8E5636" }, { cx: 104, cy: 60, r: 15, f: "#9C6B3A" },
  { cx: 58, cy: 60, r: 13, f: "#8E5636" }, { cx: 150, cy: 138, r: 13, f: "#8E5636" }, { cx: 162, cy: 146, r: 10, f: "#9C6B3A" },
  { cx: 144, cy: 150, r: 9, f: "#6E3E28" }, { cx: 100, cy: 50, r: 9, f: "#B07C4A" }, { cx: 134, cy: 58, r: 8, f: "#B07C4A" },
  { cx: 72, cy: 66, r: 7, f: "#B07C4A" }, { cx: 158, cy: 76, r: 7, f: "#B07C4A" },
];
const N_AUTUMN_TWINKLE: TwinkleDot[] = [
  { cx: 112, cy: 66, r: 3.4, f: "#C88A50", sp: 3400 },
  { cx: 146, cy: 72, r: 3.4, f: "#C88A50", sp: 3800, delay: 1000 },
  { cx: 74, cy: 82, r: 3, f: "#C88A50", sp: 3600, delay: 1800 },
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
  { l: 56, w: 14, h: 11, c: "rgba(142,74,48,0.9)", dur: 7000, off: 0.26, radius: "9 5 8 6" },
  { l: 68, w: 13, h: 10, c: "rgba(156,107,58,0.85)", dur: 8200, off: 0.56, radius: "9 5 8 6" },
  { l: 80, w: 14, h: 11, c: "rgba(126,74,46,0.9)", dur: 6400, off: 0.11, radius: "9 5 8 6" },
  { l: 90, w: 12, h: 9, c: "rgba(176,112,74,0.8)", dur: 7600, off: 0.42, radius: "9 5 8 6" },
];

export function NightAutumnScene(p: SceneProps) {
  return (
    <>
      <SceneBand w={p.w} scale={p.scale} vbH={240}>
        <Path d="M0 186 Q100 162 210 178 T400 172 L400 240 L0 240 Z" fill="rgba(96,78,72,0.5)" />
        <Path d="M0 208 Q120 196 240 204 T400 200 L400 240 L0 240 Z" fill="rgba(118,96,84,0.75)" />
        <Ellipse cx={238} cy={214} rx={7} ry={3} fill="rgba(142,74,48,0.7)" />
        <Ellipse cx={268} cy={220} rx={6} ry={2.8} fill="rgba(156,107,58,0.65)" />
        <Ellipse cx={310} cy={216} rx={7} ry={3} fill="rgba(126,74,46,0.7)" />
        <Ellipse cx={204} cy={218} rx={6} ry={2.6} fill="rgba(142,74,48,0.6)" />
        <Ellipse cx={352} cy={220} rx={6} ry={2.6} fill="rgba(156,107,58,0.55)" />
      </SceneBand>
      <SceneCanvas {...p}>
        <MoonHalo top={SKY} right={172} s={120} alpha={0.16} />
        <Moon top={32 + SKY} right={212} s={34} />
        <NightStar top={24 + SKY} right={120} s={2.5} duration={2900} bright />
        <NightStar top={60 + SKY} right={60} s={2} duration={3500} delay={1100} />
        <NightStar top={12 + SKY} right={280} s={2} duration={3200} delay={400} />
        <NightStar top={82 + SKY} right={150} s={2.5} duration={3800} delay={2100} bright />
        <NightStar top={44 + SKY} right={36} s={2} duration={2600} delay={900} />
        <NightStar top={120 + SKY} right={250} s={2} duration={3300} delay={1600} bright />
        <TreeSprite
          size={[120, 122]}
          style={{ top: 132, right: 116 }}
          duration={7500}
          opacity={0.95}
          trunk="#4A3428"
          canopy={N_AUTUMN_CANOPY}
          twinkle={N_AUTUMN_TWINKLE}
        />
        <TreeSprite
          size={[180, 184]}
          style={{ top: 74, right: 6 }}
          duration={6000}
          trunk="#4A3428"
          canopy={N_AUTUMN_CANOPY}
          twinkle={N_AUTUMN_TWINKLE}
        />
        {N_REEDS.map((r, i) => (
          <Sway
            key={i}
            deg={r.soft ? [-4, 5] : [-7, 8]}
            duration={3600}
            style={{ top: r.top, left: r.left, right: r.right, width: 26, height: r.h }}>
            <Svg width={26} height={r.h} viewBox="0 0 26 70">
              <Path
                d={i % 2 ? "M13 70 Q14 34 12 12" : "M13 70 Q12 34 14 12"}
                stroke={r.dark ? "#5C4A30" : "#6B5638"}
                strokeWidth={2.5}
                fill="none"
                strokeLinecap="round"
              />
              <Ellipse cx={i % 2 ? 12 : 14} cy={12} rx={4.5} ry={11} fill={r.ear} />
              {r.side === "l" ? (
                <Path d="M13 46 q-8 -4 -11 -12" stroke="#6B5638" strokeWidth={2} fill="none" strokeLinecap="round" />
              ) : null}
              {r.side === "r" ? (
                <Path d="M13 48 q8 -4 11 -12" stroke="#6B5638" strokeWidth={2} fill="none" strokeLinecap="round" />
              ) : null}
            </Svg>
          </Sway>
        ))}
        <Firefly top={190} left={74} s={5} duration={4800} />
        <Firefly top={214} left={96} s={4} duration={5600} delay={1700} soft />
      </SceneCanvas>
      <View pointerEvents="none" style={{ position: "absolute", top: 44, left: 0, right: 0, bottom: 0, overflow: "hidden" }}>
        <NightFlutterLayer items={N_MAPLES} keys={LEAF_KEYS} />
      </View>
    </>
  );
}

// ── 설날 밤 — 불 켜진 한옥 + 널뛰기(연날리기 금지 — 핸드오프 확정) ──────────────────────

export function NightSeolScene(p: SceneProps) {
  const seesaw = useLinearLoop(2400);
  return (
    <>
      <SceneBand w={p.w} scale={p.scale} vbH={240}>
        <Path d="M0 196 Q110 184 220 192 T400 188 L400 240 L0 240 Z" fill="rgba(186,198,232,0.92)" />
      </SceneBand>
      <SceneCanvas {...p}>
        <MoonHalo top={-16 + SKY} right={-12} s={130} alpha={0.16} />
        <Moon top={16 + SKY} right={26} s={40} />
        <NightStar top={36 + SKY} right={120} s={2.5} duration={2900} bright />
        <NightStar top={14 + SKY} right={210} s={2} duration={3500} delay={1200} />
        <NightStar top={78 + SKY} right={70} s={2} duration={3100} delay={500} />
        <NightStar top={52 + SKY} right={250} s={2.5} duration={3700} delay={1900} bright />
        <NightStar top={96 + SKY} right={170} s={2} duration={2700} delay={2600} />
        <NightStar top={30 + SKY} right={160} s={2} duration={3300} delay={900} bright />
        <Svg style={{ position: "absolute", left: 0, bottom: 0 }} width={SCENE_W} height={240} viewBox="0 0 400 240">
          <Ellipse cx={296} cy={200} rx={86} ry={7} fill="rgba(20,28,60,0.3)" />
          <Rect x={236} y={192} width={128} height={8} rx={2} fill="#6E6C84" />
          <Rect x={244} y={152} width={112} height={40} fill="#5A4030" />
          <Rect x={247} y={156} width={14} height={32} fill="#F0C468" />
          <TwinkleRect x={339} y={156} width={14} height={32} fill="#F0C468" duration={5000} delay={1400} />
          <TwinkleRect x={267} y={156} width={20} height={36} rx={1.5} fill="#F5CE7E" duration={4000} />
          <Rect x={291} y={156} width={20} height={36} rx={1.5} fill="#F0C468" />
          <Rect x={315} y={156} width={20} height={36} rx={1.5} fill="#F5CE7E" />
          <Path
            d="M273 156 V192 M281 156 V192 M297 156 V192 M305 156 V192 M321 156 V192 M329 156 V192 M267 164 H335 M267 174 H335 M267 184 H335"
            stroke="#8A6240"
            strokeWidth={1.2}
          />
          <Rect x={263} y={152} width={4} height={40} fill="#4E3520" />
          <Rect x={287} y={152} width={4} height={40} fill="#4E3520" />
          <Rect x={311} y={152} width={4} height={40} fill="#4E3520" />
          <Rect x={335} y={152} width={4} height={40} fill="#4E3520" />
          <Rect x={228} y={148} width={144} height={5} fill="#4E3520" />
          <Path
            d="M256 102 Q300 110 344 102 C362 114 376 128 392 140 Q346 152 300 150 Q254 152 208 140 C224 128 238 114 256 102 Z"
            fill="#262B3E"
          />
          <Path d="M256 93 Q300 101 344 93 L344 103 Q300 111 256 103 Z" fill="#1A1E30" />
          <Rect x={250} y={89} width={12} height={15} rx={2.5} fill="#1A1E30" />
          <Rect x={338} y={89} width={12} height={15} rx={2.5} fill="#1A1E30" />
          <Path
            d="M268 104 Q256 126 242 141 M284 104 Q278 126 272 147 M300 104 V149 M316 104 Q322 126 328 147 M332 104 Q344 126 358 141"
            stroke="#1E2334"
            strokeWidth={1.8}
            fill="none"
          />
          <Path
            d="M212 139 Q254 149 300 147 Q346 149 388 139"
            stroke="rgba(210,220,245,0.7)"
            strokeWidth={4}
            strokeDasharray="0.8 7.4"
            strokeLinecap="round"
            fill="none"
          />
          <Path d="M254 91 Q300 100 346 91" stroke="#E8EDF8" strokeWidth={5} strokeLinecap="round" fill="none" opacity={0.9} />
          <Ellipse cx={256} cy={87} rx={7} ry={2.5} fill="#E8EDF8" opacity={0.9} />
          <Ellipse cx={344} cy={87} rx={7} ry={2.5} fill="#E8EDF8" opacity={0.9} />
          <Ellipse cx={270} cy={118} rx={11} ry={3} fill="#E8EDF8" opacity={0.85} />
          <Ellipse cx={322} cy={124} rx={13} ry={3.5} fill="#E8EDF8" opacity={0.85} />
          <Ellipse cx={296} cy={111} rx={8} ry={2.5} fill="#E8EDF8" opacity={0.85} />
          <Ellipse cx={238} cy={132} rx={9} ry={2.8} fill="#E8EDF8" opacity={0.8} />
          <Ellipse cx={360} cy={130} rx={9} ry={2.8} fill="#E8EDF8" opacity={0.8} />
          <Path d="M214 137 Q254 147 300 145 Q346 147 386 137" stroke="#E8EDF8" strokeWidth={4} strokeLinecap="round" fill="none" opacity={0.8} />
          {/* 홍등 — 글로우 트윙클 */}
          <Line x1={242} y1={142} x2={242} y2={152} stroke="#8A6240" strokeWidth={1.6} />
          <Rect x={237} y={152} width={10} height={5} rx={2} fill="#C08A2E" />
          <Twinkle cx={242} cy={163} r={13} fill="rgba(232,93,93,0.3)" duration={3200} />
          <Circle cx={242} cy={163} r={9} fill="#E85D5D" />
          {/* 널뛰기 받침(볏짚단) */}
          <Ellipse cx={172} cy={191.5} rx={13} ry={4.5} fill="#8A7148" />
          <Path d="M162 190 q10 -4 20 0 M164 193 q8 -3 16 0" stroke="#6B5638" strokeWidth={1} fill="none" />
          {/* 눈사람 */}
          <Ellipse cx={70} cy={200} rx={26} ry={4.5} fill="rgba(20,28,60,0.3)" />
          <Circle cx={70} cy={186} r={12} fill="#E8ECF8" stroke="#B8C4DE" strokeWidth={1.4} />
          <Circle cx={70} cy={168} r={8.5} fill="#E8ECF8" stroke="#B8C4DE" strokeWidth={1.4} />
          <Circle cx={67} cy={166} r={1.3} fill="#2A3040" />
          <Circle cx={73} cy={166} r={1.3} fill="#2A3040" />
          <Polygon points="70,168 79,170 70,172" fill="#C06A32" />
        </Svg>
        {/* 널판(cdBoard) — 캔버스 y = 밴드 svg y + 46 */}
        <SeesawBoard p={seesaw} style={{ left: 128, top: 230, width: 88, height: 6 }}>
          <Svg width={88} height={6} viewBox="128 184 88 6">
            <Rect x={128} y={184.5} width={88} height={4.5} rx={2} fill="#8A6240" />
            <Path d="M132 186.8 h80" stroke="#6E4A2A" strokeWidth={0.8} />
          </Svg>
        </SeesawBoard>
        {/* 소녀 2명 — 교대 점프(cdJumpA/B, 2.4s 동기) */}
        <SeesawJumper p={seesaw} style={{ left: 125, top: 194, width: 30, height: 38 }}>
          <Svg width={30} height={38} viewBox="125 148 30 38">
            <Path d="M135 164.5 q-5 -1.2 -7.8 -5.2" stroke="#E8E0D0" strokeWidth={3.6} fill="none" strokeLinecap="round" />
            <Path d="M145 164.5 q5 -1.2 7.8 -5.2" stroke="#E8E0D0" strokeWidth={3.6} fill="none" strokeLinecap="round" />
            <Circle cx={126.8} cy={158.8} r={1.7} fill="#F5D5BE" />
            <Circle cx={153.2} cy={158.8} r={1.7} fill="#F5D5BE" />
            <Path d="M131.5 184.5 q8.5 3 17 0 l-3.6 -15.5 q-4.9 -1.8 -9.8 0 Z" fill="#B03A32" />
            <Path d="M136.5 172 l-1.6 11 M143.5 172 l1.6 11 M140 172 l0 11.6" stroke="#8E2A24" strokeWidth={0.8} fill="none" />
            <Path d="M134.2 169.5 q5.8 -2 11.6 0 l0 -6.4 q-5.8 -2.4 -11.6 0 Z" fill="#E8E0D0" />
            <Path d="M140 165.5 q-2 1 -2.4 3.8" stroke="#B03A32" strokeWidth={1.3} fill="none" strokeLinecap="round" />
            <Circle cx={140} cy={157} r={5.5} fill="#F5D5BE" />
            <Path d="M134.6 155.4 q5.4 -7.2 10.8 0 l-0.9 2.2 q-4.6 -4 -9 0 Z" fill="#2F2A33" />
            <Circle cx={143.6} cy={150.8} r={2} fill="#2F2A33" />
            <Path d="M144 152.6 l1.4 4" stroke="#B03A32" strokeWidth={1.2} strokeLinecap="round" />
            <Circle cx={138} cy={156.6} r={0.8} fill="#2F2A33" />
            <Circle cx={142} cy={156.6} r={0.8} fill="#2F2A33" />
            <Path d="M138.8 159.2 q1.2 1.1 2.4 0" stroke="#A05840" strokeWidth={0.8} fill="none" strokeLinecap="round" />
            <Circle cx={136.4} cy={158.4} r={1} fill="rgba(240,150,150,0.4)" />
            <Circle cx={143.6} cy={158.4} r={1} fill="rgba(240,150,150,0.4)" />
          </Svg>
        </SeesawJumper>
        <SeesawJumper p={seesaw} phaseB style={{ left: 189, top: 194, width: 30, height: 38 }}>
          <Svg width={30} height={38} viewBox="189 148 30 38">
            <Path d="M199 164.5 q-5 -1.2 -7.8 -5.2" stroke="#C08A2E" strokeWidth={3.6} fill="none" strokeLinecap="round" />
            <Path d="M209 164.5 q5 -1.2 7.8 -5.2" stroke="#C08A2E" strokeWidth={3.6} fill="none" strokeLinecap="round" />
            <Circle cx={190.8} cy={158.8} r={1.7} fill="#F5D5BE" />
            <Circle cx={217.2} cy={158.8} r={1.7} fill="#F5D5BE" />
            <Path d="M195.5 184.5 q8.5 3 17 0 l-3.6 -15.5 q-4.9 -1.8 -9.8 0 Z" fill="#3E4C9A" />
            <Path d="M200.5 172 l-1.6 11 M207.5 172 l1.6 11 M204 172 l0 11.6" stroke="#2E3A78" strokeWidth={0.8} fill="none" />
            <Path d="M198.2 169.5 q5.8 -2 11.6 0 l0 -6.4 q-5.8 -2.4 -11.6 0 Z" fill="#C08A2E" />
            <Path d="M204 165.5 q-2 1 -2.4 3.8" stroke="#8E5E1E" strokeWidth={1.3} fill="none" strokeLinecap="round" />
            <Circle cx={204} cy={157} r={5.5} fill="#F5D5BE" />
            <Path d="M198.6 155.4 q5.4 -7.2 10.8 0 l-0.9 2.2 q-4.6 -4 -9 0 Z" fill="#2F2A33" />
            <Circle cx={207.6} cy={150.8} r={2} fill="#2F2A33" />
            <Path d="M208 152.6 l1.4 4" stroke="#B03A32" strokeWidth={1.2} strokeLinecap="round" />
            <Circle cx={202} cy={156.6} r={0.8} fill="#2F2A33" />
            <Circle cx={206} cy={156.6} r={0.8} fill="#2F2A33" />
            <Path d="M202.8 159.2 q1.2 1.1 2.4 0" stroke="#A05840" strokeWidth={0.8} fill="none" strokeLinecap="round" />
            <Circle cx={200.4} cy={158.4} r={1} fill="rgba(240,150,150,0.4)" />
            <Circle cx={207.6} cy={158.4} r={1} fill="rgba(240,150,150,0.4)" />
          </Svg>
        </SeesawJumper>
      </SceneCanvas>
      <SnowLayer tall glow style={{ top: 8, left: 0, right: 0, bottom: 0 }} />
    </>
  );
}

// ── 추석 밤 — 보름달 증폭 + 떡방아 토끼 + 불 켜진 한옥 ─────────────────────────────────

export function NightChuseokScene(p: SceneProps) {
  const pound = usePingPong(2200);
  const halo = usePingPong(5000);
  const leanSt = useAnimatedStyle(() => ({ transform: [{ rotate: `${6 * pound.value}deg` }] }));
  // cdPoundV 아크 모션(시안 확정판) — 들어올림(-8°/-8px) → 내려찍음(+9px)을 왕복값으로 근사.
  const poundSt = useAnimatedStyle(() => {
    const t = pound.value;
    const lift = t < 0.4 ? t / 0.4 : 0;
    const strike = t >= 0.4 ? (t - 0.4) / 0.6 : 0;
    return {
      transform: [
        { translateX: -2 * lift - 1 * strike },
        { translateY: -8 * lift + 9 * strike },
        { rotate: `${-8 * lift + 3 * strike}deg` },
      ],
    };
  });
  const haloSt = useAnimatedStyle(() => ({ opacity: 0.55 + 0.45 * halo.value }));

  return (
    <>
      <SceneBand w={p.w} scale={p.scale} vbH={SCENE_H}>
        <Path d="M0 232 Q110 220 220 228 T400 224 L400 286 L0 286 Z" fill="rgba(84,78,128,0.55)" />
      </SceneBand>
      <SceneCanvas {...p}>
        <NightStar top={10 + SKY} right={110} s={2.5} duration={2800} bright />
        <NightStar top={44 + SKY} right={60} s={2} duration={3400} delay={1100} />
        <NightStar top={80 + SKY} right={160} s={2} duration={3100} delay={400} />
        <NightStar top={20 + SKY} right={210} s={2.5} duration={3200} delay={1700} bright />
        <NightStar top={58 + SKY} right={110} s={2} duration={2700} delay={2300} />
        <NightStar top={104 + SKY} right={36} s={2} duration={3600} delay={800} bright />
        <NightStar top={8 + SKY} right={60} s={2} duration={3000} delay={2900} />
        <Svg style={{ position: "absolute", left: 0, top: 0 }} width={SCENE_W} height={SCENE_H} viewBox="0 0 400 286">
          {/* 보름달 증폭 — 광륜은 아래 Animated 원, 여기는 본체. 카드 상단 잘림만큼 +10 내림. */}
          <G transform="translate(0,10)">
            <Circle cx={100} cy={98} r={72} fill="rgba(245,206,126,0.45)" />
            <Circle cx={100} cy={98} r={54} fill="#FFF9E4" />
            <Circle cx={78} cy={84} r={6} fill="rgba(228,186,110,0.42)" />
            <Circle cx={118} cy={70} r={4.5} fill="rgba(228,186,110,0.38)" />
            <Circle cx={66} cy={112} r={5} fill="rgba(228,186,110,0.38)" />
            <Ellipse cx={86} cy={136} rx={15} ry={2.6} fill="rgba(180,150,90,0.3)" />
            <Ellipse cx={114} cy={139} rx={12} ry={2.4} fill="rgba(180,150,90,0.3)" />
            {/* 절구 */}
            <Path d="M103 106 h22 l-2.5 26 q-0.8 5 -8.5 5 q-7.7 0 -8.5 -5 Z" fill="#6E4A2A" />
            <Path d="M104 116 h20 M105 126 h18" stroke="#523618" strokeWidth={1.2} />
            <Ellipse cx={114} cy={106} rx={11} ry={3} fill="#8A6240" />
            <Ellipse cx={114} cy={105} rx={7} ry={2.2} fill="#FFF8E8" />
          </G>
          {/* 감나무(실루엣 톤) — 주간과 같은 +18 하향 */}
          <Path d="M400 38 Q348 52 312 84 M366 56 Q356 74 358 90" stroke="#3E3226" strokeWidth={7} fill="none" strokeLinecap="round" />
          <Ellipse cx={330} cy={70} rx={14} ry={7} fill="#2E4A3E" transform="rotate(-22 330 70)" />
          <Ellipse cx={368} cy={54} rx={12} ry={6} fill="#35564A" transform="rotate(-10 368 54)" />
          <Ellipse cx={298} cy={80} rx={11} ry={5.5} fill="#2E4A3E" transform="rotate(-30 298 80)" />
          <Circle cx={338} cy={102} r={13} fill="#C46A2E" />
          <Circle cx={306} cy={94} r={11} fill="#B85E28" />
          <Circle cx={372} cy={82} r={10} fill="#C46A2E" />
          <Path d="M331 92 h14 l-3 4 h-8 Z" fill="#2E4A3E" />
          <Path d="M300 85 h12 l-2.5 4 h-7 Z" fill="#2E4A3E" />
          <Path d="M366 74 h12 l-2.5 4 h-7 Z" fill="#2E4A3E" />
          {/* 한옥 — 불 켜진 창호 */}
          <Rect x={236} y={224} width={128} height={8} rx={2} fill="#6E6C84" />
          <Rect x={244} y={184} width={112} height={40} fill="#5A4030" />
          <Rect x={247} y={188} width={14} height={32} fill="#C4B694" />
          <Rect x={339} y={188} width={14} height={32} fill="#C4B694" />
          <TwinkleRect x={267} y={188} width={20} height={36} rx={1.5} fill="#F5CE7E" duration={4000} />
          <Rect x={291} y={188} width={20} height={36} rx={1.5} fill="#F0C468" />
          <TwinkleRect x={315} y={188} width={20} height={36} rx={1.5} fill="#F5CE7E" duration={5000} delay={1200} />
          <Path
            d="M273 188 V224 M281 188 V224 M297 188 V224 M305 188 V224 M321 188 V224 M329 188 V224 M267 196 H335 M267 206 H335 M267 216 H335"
            stroke="#8A6240"
            strokeWidth={1.2}
          />
          <Rect x={263} y={184} width={4} height={40} fill="#4E3520" />
          <Rect x={287} y={184} width={4} height={40} fill="#4E3520" />
          <Rect x={311} y={184} width={4} height={40} fill="#4E3520" />
          <Rect x={335} y={184} width={4} height={40} fill="#4E3520" />
          <Rect x={228} y={180} width={144} height={5} fill="#4E3520" />
          <Path
            d="M256 134 Q300 142 344 134 C362 146 376 160 392 172 Q346 184 300 182 Q254 184 208 172 C224 160 238 146 256 134 Z"
            fill="#232738"
          />
          <Path d="M256 125 Q300 133 344 125 L344 135 Q300 143 256 135 Z" fill="#1C2030" />
          <Rect x={250} y={121} width={12} height={15} rx={2.5} fill="#1C2030" />
          <Rect x={338} y={121} width={12} height={15} rx={2.5} fill="#1C2030" />
          <Path
            d="M268 136 Q256 158 242 173 M284 136 Q278 158 272 179 M300 136 V181 M316 136 Q322 158 328 179 M332 136 Q344 158 358 173"
            stroke="#1A1E30"
            strokeWidth={1.8}
            fill="none"
          />
          <Path
            d="M212 171 Q254 181 300 179 Q346 181 388 171"
            stroke="rgba(200,205,235,0.45)"
            strokeWidth={4}
            strokeDasharray="0.8 7.4"
            strokeLinecap="round"
            fill="none"
          />
        </Svg>
        {/* 보름달 광륜(cdMoonHalo) — 본체와 같은 중심(달 +10 하향 반영) */}
        <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 12, top: 20, width: 176, height: 176 }, haloSt]}>
          <Svg width={176} height={176}>
            <Circle cx={88} cy={88} r={88} fill="rgba(245,206,126,0.24)" />
          </Svg>
        </Animated.View>
        {/* 달토끼(등쪽 통통한 몸통 rx14.5) — 달과 함께 +10 하향, 회전 기준은 주간과 동일 */}
        <Animated.View
          pointerEvents="none"
          style={[{ position: "absolute", left: 66, top: 65, width: 46, height: 86, transformOrigin: "55% 96%" }, leanSt]}>
          <Svg width={46} height={86} viewBox="66 55 46 86">
            <Circle cx={74} cy={122} r={4.5} fill="#FFFFFF" />
            <Ellipse cx={84.5} cy={118} rx={14.5} ry={16.5} fill="#FBF8F0" stroke="#D8CBA8" strokeWidth={1.2} />
            <Ellipse cx={80} cy={133} rx={5.5} ry={3} fill="#FBF8F0" stroke="#D8CBA8" strokeWidth={1} />
            <Ellipse cx={93} cy={133} rx={5.5} ry={3} fill="#FBF8F0" stroke="#D8CBA8" strokeWidth={1} />
            <Ellipse cx={82} cy={74} rx={4} ry={14} fill="#FBF8F0" stroke="#D8CBA8" strokeWidth={1} transform="rotate(-10 82 74)" />
            <Ellipse cx={95} cy={73} rx={4} ry={14} fill="#FBF8F0" stroke="#D8CBA8" strokeWidth={1} transform="rotate(6 95 73)" />
            <Ellipse cx={82} cy={76} rx={2} ry={9} fill="#F0BFC6" transform="rotate(-10 82 76)" />
            <Ellipse cx={95} cy={75} rx={2} ry={9} fill="#F0BFC6" transform="rotate(6 95 75)" />
            <Circle cx={88} cy={94} r={11} fill="#FBF8F0" stroke="#D8CBA8" strokeWidth={1.2} />
            <Ellipse cx={87} cy={105} rx={7} ry={6.5} fill="#FBF8F0" />
            <Circle cx={93} cy={92} r={1.6} fill="#4A4038" />
            <Circle cx={98} cy={96} r={1.3} fill="#E0A0A8" />
            <Circle cx={91} cy={99} r={2} fill="rgba(240,170,180,0.5)" />
          </Svg>
        </Animated.View>
        {/* 절굿공이 + 팔 */}
        <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 90, top: 72, width: 32, height: 48 }, poundSt]}>
          <Svg width={32} height={48} viewBox="90 62 32 48">
            <Rect x={111} y={70} width={6} height={34} rx={3} fill="#A97B4F" />
            <Rect x={108} y={63} width={12} height={11} rx={4} fill="#8A6240" />
            <Path d="M93 108 Q103 102 112 93" stroke="#FBF8F0" strokeWidth={5} fill="none" strokeLinecap="round" />
          </Svg>
        </Animated.View>
        {/* 옅은 구름(야간 톤) */}
        <Drift from={-8} to={12} duration={10000} style={{ top: 150, left: 44, width: 130, height: 26 }}>
          <Svg width={130} height={26}>
            <Rect x={0} y={0} width={104} height={12} rx={6} fill="rgba(150,162,205,0.38)" />
            <Rect x={20} y={13} width={72} height={10} rx={5} fill="rgba(150,162,205,0.26)" />
          </Svg>
        </Drift>
      </SceneCanvas>
      <View pointerEvents="none" style={{ position: "absolute", top: 36, left: 0, right: 0, bottom: 0, overflow: "hidden" }}>
        <NightFlutterLayer
          items={[
            { l: 58, w: 12, h: 9, c: "rgba(142,74,48,0.85)", dur: 7400, off: 0.3, radius: "9 5 8 6" },
            { l: 72, w: 11, h: 8, c: "rgba(156,107,58,0.8)", dur: 8600, off: 0.59, radius: "9 5 8 6" },
            { l: 84, w: 12, h: 9, c: "rgba(126,74,46,0.85)", dur: 6800, off: 0.15, radius: "9 5 8 6" },
            { l: 64, w: 10, h: 8, c: "rgba(176,112,74,0.75)", dur: 7900, off: 0.48, radius: "9 5 8 6" },
          ]}
          keys={LEAF_KEYS}
        />
      </View>
    </>
  );
}

// ── 크리스마스 밤 — 전구 글로우 강화 + 야간 비행 산타 ──────────────────────────────────

export function NightXmasScene(p: SceneProps) {
  const sleigh = useLinearLoop(13_000);
  const sleighSt = useAnimatedStyle(() => {
    const t = sleigh.value;
    // 주간 XmasScene 과 같은 궤적 보정 — 모바일 카드에서 계속 보이도록 상승 폭을 줄인다.
    const x = t < 0.5 ? -170 + (120 - -170) * (t / 0.5) : 120 + (450 - 120) * ((t - 0.5) / 0.5);
    const y = t < 0.5 ? 78 + (30 - 78) * (t / 0.5) : 30 + (-6 - 30) * ((t - 0.5) / 0.5);
    return {
      transform: [{ translateX: x }, { translateY: y }],
      opacity: t < 0.08 ? t / 0.08 : t > 0.92 ? (1 - t) / 0.08 : 1,
    };
  });

  return (
    <>
      <SceneBand w={p.w} scale={p.scale} vbH={SCENE_H}>
        <Path d="M0 224 Q110 212 220 220 T400 216 L400 286 L0 286 Z" fill="rgba(196,206,236,0.95)" />
      </SceneBand>
      <SceneCanvas {...p}>
        <MoonHalo top={-14 + SKY} right={-8} s={120} alpha={0.16} />
        <Moon top={16 + SKY} right={26} s={42} />
        <NightStar top={70 + SKY} right={120} s={2.5} duration={2900} bright />
        <NightStar top={100 + SKY} right={56} s={2} duration={3400} delay={1300} />
        <NightStar top={88 + SKY} right={210} s={2} duration={3100} delay={600} />
        {/* 산타 썰매(야간 실루엣 톤) — 지상 전경보다 먼저 */}
        <Animated.View pointerEvents="none" style={[{ position: "absolute", top: 16, left: 0, width: 150, height: 48 }, sleighSt]}>
          <Svg width={150} height={48} viewBox="0 0 150 48">
            <Path d="M4 40 q-3 6 5 8 h32" stroke="#C09A3E" strokeWidth={2.5} fill="none" strokeLinecap="round" />
            <Path d="M10 22 q-9 10 3 17 h28 q11 0 12 -11 l-1 -9 h-26 q-10 0 -16 3 z" fill="#8E3226" />
            <Circle cx={18} cy={18} r={8} fill="#5A4030" />
            <Circle cx={36} cy={12} r={5} fill="#E8C4AC" />
            <Polygon points="30,10 36,0 42,10" fill="#B03A32" />
            <Circle cx={42} cy={1.5} r={2} fill="#F2F5FC" />
            <Rect x={30} y={10} width={12} height={3} rx={1.5} fill="#F2F5FC" />
            <Rect x={29} y={15} width={15} height={11} rx={4} fill="#B03A32" />
            <Path d="M54 26 L88 24 L120 22" stroke="#4A3428" strokeWidth={1.5} fill="none" />
            <Ellipse cx={94} cy={30} rx={12} ry={6.5} fill="#6E4A32" />
            <Path d="M88 36 v8 M100 36 v8" stroke="#4A3428" strokeWidth={2.4} strokeLinecap="round" />
            <Circle cx={106} cy={21} r={4.5} fill="#6E4A32" />
            <Path d="M106 17 q-2 -6 -7 -8 M107 17 q3 -6 8 -7" stroke="#4A3428" strokeWidth={1.8} fill="none" strokeLinecap="round" />
            <Ellipse cx={124} cy={28} rx={12} ry={6.5} fill="#7E5A3C" />
            <Path d="M118 34 v8 M130 34 v8" stroke="#4A3428" strokeWidth={2.4} strokeLinecap="round" />
            <Circle cx={136} cy={19} r={4.5} fill="#7E5A3C" />
            <Path d="M136 15 q-2 -6 -7 -8 M137 15 q3 -6 8 -7" stroke="#4A3428" strokeWidth={1.8} fill="none" strokeLinecap="round" />
            <Twinkle cx={140} cy={20} r={4.5} fill="rgba(232,67,58,0.4)" duration={1200} />
            <Twinkle cx={140} cy={20} r={2} fill="#E8433A" duration={1200} />
          </Svg>
        </Animated.View>
        <Svg style={{ position: "absolute", left: 0, top: 0 }} width={SCENE_W} height={SCENE_H} viewBox="0 0 400 286">
          <Ellipse cx={104} cy={224} rx={60} ry={7} fill="rgba(18,26,54,0.4)" />
          <Rect x={96} y={208} width={15} height={18} rx={3} fill="#5A4030" />
          <Polygon points="104,140 164,210 44,210" fill="#1E5038" />
          <Polygon points="104,122 152,182 56,182" fill="#255C44" />
          <Polygon points="104,106 142,156 66,156" fill="#2C6A50" />
          <Polygon points="104,94 130,136 78,136" fill="#33785C" />
          <Path d="M50 208 Q104 197 158 208" stroke="#D8E2F5" strokeWidth={5} fill="none" strokeLinecap="round" opacity={0.8} />
          <Path d="M62 180 Q104 171 146 180" stroke="#D8E2F5" strokeWidth={4} fill="none" strokeLinecap="round" opacity={0.8} />
          <Path d="M72 154 Q104 147 136 154" stroke="#D8E2F5" strokeWidth={3.5} fill="none" strokeLinecap="round" opacity={0.8} />
          <Path d="M66 194 Q104 208 142 194" stroke="#D8AE4A" strokeWidth={3} fill="none" />
          <Path d="M77 166 Q104 177 131 166" stroke="#D8AE4A" strokeWidth={2.5} fill="none" />
          {/* 전구 8개 — 이중 원(halo + 코어) 글로우 */}
          <Twinkle cx={82} cy={192} r={11} fill="rgba(232,93,93,0.55)" duration={1800} />
          <Twinkle cx={82} cy={192} r={4.4} fill="#FF6E66" duration={1800} />
          <Twinkle cx={130} cy={190} r={11} fill="rgba(95,182,232,0.55)" duration={2200} delay={500} />
          <Twinkle cx={130} cy={190} r={4.4} fill="#7CC8F2" duration={2200} delay={500} />
          <Twinkle cx={90} cy={160} r={10} fill="rgba(242,193,78,0.55)" duration={2000} delay={1000} />
          <Twinkle cx={90} cy={160} r={4} fill="#FFD35E" duration={2000} delay={1000} />
          <Twinkle cx={122} cy={158} r={10} fill="rgba(232,93,93,0.55)" duration={2400} delay={300} />
          <Twinkle cx={122} cy={158} r={4} fill="#FF6E66" duration={2400} delay={300} />
          <Twinkle cx={104} cy={130} r={9.5} fill="rgba(95,182,232,0.55)" duration={2100} delay={900} />
          <Twinkle cx={104} cy={130} r={3.8} fill="#7CC8F2" duration={2100} delay={900} />
          <Twinkle cx={104} cy={202} r={9.5} fill="rgba(242,193,78,0.55)" duration={2300} delay={700} />
          <Twinkle cx={104} cy={202} r={3.8} fill="#FFD35E" duration={2300} delay={700} />
          <Twinkle cx={70} cy={196} r={9} fill="rgba(95,182,232,0.55)" duration={1900} delay={1300} />
          <Twinkle cx={70} cy={196} r={3.6} fill="#7CC8F2" duration={1900} delay={1300} />
          <Twinkle cx={112} cy={146} r={9} fill="rgba(232,93,93,0.55)" duration={2500} delay={1600} />
          <Twinkle cx={112} cy={146} r={3.6} fill="#FF6E66" duration={2500} delay={1600} />
          {/* 꼭대기 별 — 이중 광륜 + 십자 광선 */}
          <Twinkle cx={104} cy={79} r={22} fill="rgba(245,206,126,0.3)" duration={2000} />
          <Twinkle cx={104} cy={79} r={14} fill="rgba(245,206,126,0.55)" duration={2000} />
          <Path
            d="M104 58 V64 M104 94 V100 M86 79 H92 M116 79 H122"
            stroke="rgba(255,228,154,0.8)"
            strokeWidth={1.6}
            strokeLinecap="round"
          />
          <Polygon points="104,66 107.5,76 117,76 109.5,82 112.5,92 104,86 95.5,92 98.5,82 90,76 100.5,76" fill="#FFE49A" />
          <Rect x={40} y={208} width={28} height={20} rx={3} fill="#A83A30" />
          <Rect x={51} y={208} width={6} height={20} fill="#D8AE4A" />
          <Rect x={150} y={212} width={24} height={16} rx={3} fill="#3E4C9A" />
          <Rect x={159} y={212} width={6} height={16} fill="#E8ECF8" />
          <Rect x={72} y={216} width={17} height={12} rx={3} fill="#2E8A70" />
        </Svg>
        {/* 눈사람(야간 톤) */}
        <Sway deg={6} duration={3800} style={{ top: 150, right: 56, width: 64, height: 80 }}>
          <Svg width={64} height={80} viewBox="0 0 64 80">
            <Ellipse cx={32} cy={76} rx={24} ry={4} fill="rgba(18,26,54,0.4)" />
            <Circle cx={32} cy={56} r={20} fill="#F2F5FC" stroke="#B8C4DE" strokeWidth={1.5} />
            <Circle cx={32} cy={26} r={14} fill="#F2F5FC" stroke="#B8C4DE" strokeWidth={1.5} />
            <Rect x={22} y={6} width={20} height={10} rx={1.5} fill="#1E2434" />
            <Rect x={18} y={14} width={28} height={4} rx={2} fill="#1E2434" />
            <Circle cx={27} cy={24} r={1.6} fill="#1E2434" />
            <Circle cx={37} cy={24} r={1.6} fill="#1E2434" />
            <Polygon points="32,26 46,28 32,30" fill="#C06A32" />
            <Rect x={23} y={37} width={18} height={6} rx={3} fill="#B03A32" />
            <Rect x={33} y={40} width={6} height={14} rx={3} fill="#B03A32" />
            <Path d="M12 50 L0 40 M52 50 L64 38" stroke="#5A4030" strokeWidth={3} strokeLinecap="round" />
            <Circle cx={32} cy={50} r={1.9} fill="#1E2434" />
            <Circle cx={32} cy={58} r={1.9} fill="#1E2434" />
          </Svg>
        </Sway>
      </SceneCanvas>
      <SnowLayer tall glow style={{ top: 8, left: 0, right: 0, bottom: 0 }} />
    </>
  );
}

// ── 여름휴가 밤 — 달빛 물결 + 백사장 모닥불 + 랜턴 요트 ──────────────────────────────

export function NightSummerScene(p: SceneProps) {
  const sail = useLinearLoop(26_000);
  const bob = usePingPong(4000);
  const waveA = usePingPong(6000);
  const waveB = usePingPong(8000);
  const fireGlow = usePingPong(1800);

  const sailSt = useAnimatedStyle(() => ({ transform: [{ translateX: -100 + 580 * sail.value }] }));
  const bobSt = useAnimatedStyle(() => ({
    transform: [{ translateY: -5 * bob.value }, { rotate: `${-2.5 + 5 * bob.value}deg` }],
  }));
  const waveASt = useAnimatedStyle(() => ({ transform: [{ translateX: -12 + 24 * waveA.value }] }));
  const waveBSt = useAnimatedStyle(() => ({ transform: [{ translateX: 12 - 24 * waveB.value }] }));
  const fireGlowSt = useAnimatedStyle(() => ({ opacity: 0.55 + 0.45 * fireGlow.value }));

  return (
    <>
      <SceneBand w={p.w} scale={p.scale} vbH={SCENE_H}>
        <Defs>
          <LinearGradient id="wSeaGradN" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#27477A" />
            <Stop offset="1" stopColor="#152A4E" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={156} width={400} height={74} fill="url(#wSeaGradN)" />
        <Rect x={0} y={156} width={400} height={2.5} fill="rgba(190,208,245,0.3)" />
        <Path d="M0 230 Q100 216 200 226 T400 222 L400 286 L0 286 Z" fill="#4A4238" />
        <Path d="M0 230 Q100 216 200 226 T400 222" stroke="rgba(210,222,250,0.22)" strokeWidth={3} fill="none" />
      </SceneBand>
      <SceneCanvas {...p}>
        <MoonHalo top={-26 + SKY} right={-20} s={150} alpha={0.22} duration={4500} />
        <Moon
          top={18 + SKY}
          right={28}
          s={46}
          craters={[
            { t: 10, l: 12, s: 8, o: 0.5 },
            { t: 24, l: 26, s: 5, o: 0.42 },
          ]}
        />
        <NightStar top={30 + SKY} right={110} s={2.5} duration={2800} bright />
        <NightStar top={64 + SKY} right={156} s={2} duration={3400} delay={900} />
        <NightStar top={14 + SKY} right={196} s={2.5} duration={3100} delay={1500} bright />
        <NightStar top={92 + SKY} right={70} s={2} duration={2600} delay={400} />
        <SparkleStar top={48 + SKY} right={236} s={11} duration={3600} delay={2000} fill="#E8EFFF" />
        {/* 달빛 물결 반사 기둥 + 트윙클 글린트 — 전경(야자수·파라솔)보다 뒤 */}
        <View pointerEvents="none" style={{ position: "absolute", top: 160, right: 34, width: 30, height: 64 }}>
          <Svg width={30} height={64}>
            <Defs>
              <LinearGradient id="moonPillar" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#FFECB4" stopOpacity={0.2} />
                <Stop offset="1" stopColor="#FFECB4" stopOpacity={0.05} />
              </LinearGradient>
            </Defs>
            <Rect x={0} y={0} width={30} height={64} rx={8} fill="url(#moonPillar)" />
          </Svg>
        </View>
        <Svg pointerEvents="none" style={{ position: "absolute", left: 0, top: 0 }} width={SCENE_W} height={SCENE_H} viewBox="0 0 400 286">
          <TwinkleRect x={345} y={168} width={15} height={3} rx={1.5} fill="rgba(255,238,190,0.75)" duration={2200} />
          <TwinkleRect x={341} y={182} width={11} height={2.6} rx={1.3} fill="rgba(255,238,190,0.6)" duration={2800} delay={700} />
          <TwinkleRect x={350} y={196} width={14} height={3} rx={1.5} fill="rgba(255,238,190,0.68)" duration={2500} delay={1300} />
          <TwinkleRect x={344} y={210} width={10} height={2.4} rx={1.2} fill="rgba(255,238,190,0.55)" duration={3000} delay={1900} />
        </Svg>
        {/* 랜턴 요트 — 야간 항해(26s). 전경(야자수·파라솔) 뒤로 통과한다. */}
        <Animated.View pointerEvents="none" style={[{ position: "absolute", top: 148, left: 0, width: 96, height: 56 }, sailSt]}>
          <Animated.View style={[{ width: 96, height: 56 }, bobSt]}>
            <Svg width={96} height={56} viewBox="0 0 96 56">
              <Path d="M4 44 q18 6 40 4 M0 50 q26 8 56 4" stroke="rgba(200,216,250,0.28)" strokeWidth={3} fill="none" strokeLinecap="round" />
              <Path d="M52 8 L52 36" stroke="#2E2838" strokeWidth={2} />
              <Path d="M52 8 L52 36 L32 36 Z" fill="#8E97B8" />
              <Path d="M55 12 L55 36 L72 36 Z" fill="#6E7796" />
              <Path d="M28 38 q22 10 46 0 l-6 10 h-34 z" fill="#332A3E" />
              <Twinkle cx={53} cy={6} r={2.2} fill="#FFD98A" duration={1600} />
            </Svg>
          </Animated.View>
        </Animated.View>
        <Svg style={{ position: "absolute", left: 0, top: 0 }} width={SCENE_W} height={SCENE_H} viewBox="0 0 400 286">
          <Ellipse cx={300} cy={236} rx={36} ry={5} fill="rgba(15,22,42,0.35)" />
          <Path d="M296 232 C288 192 300 162 286 128" stroke="#3A3040" strokeWidth={9} fill="none" strokeLinecap="round" />
          <G transform="rotate(-10 352 186)">
            <Path d="M320 188 Q352 150 384 188 Z" fill="#3A3550" />
            <Path d="M332 186 Q346 156 352 187 Z" fill="#59547A" opacity={0.9} />
            <Path d="M358 187 Q364 156 376 185 Z" fill="#59547A" opacity={0.9} />
            {/* 꼭지 — 주간과 같은 보정: 갓 곡선 정점(y≈169)에 붙인다. */}
            <Path d="M352 172 L352 163" stroke="#2E2838" strokeWidth={3} strokeLinecap="round" />
          </G>
          <Line x1={352} y1={186} x2={358} y2={232} stroke="#2E2838" strokeWidth={3.5} strokeLinecap="round" />
        </Svg>
        {/* 야자수 잎(실루엣 톤) */}
        <Sway deg={6} duration={5000} origin="49% 78%" style={{ top: 70, left: 222, width: 130, height: 74 }}>
          <Svg width={130} height={74} viewBox="0 0 130 74">
            <Path d="M64 58 Q30 40 4 48 Q34 56 66 66 Z" fill="#28495A" />
            <Path d="M64 58 Q42 22 16 16 Q46 36 66 62 Z" fill="#2E5568" />
            <Path d="M64 58 Q64 18 48 4 Q72 28 70 60 Z" fill="#224050" />
            <Path d="M64 58 Q90 20 116 16 Q90 38 68 62 Z" fill="#2E5568" />
            <Path d="M64 58 Q102 40 126 50 Q96 58 64 68 Z" fill="#28495A" />
            <Circle cx={62} cy={66} r={5} fill="#3A2E24" />
            <Circle cx={73} cy={62} r={5} fill="#33271E" />
          </Svg>
        </Sway>
        {/* 백사장 모닥불 — 장작 + 불꽃(cdFlame) + 불티(cdSpark) + 주황 글로우 */}
        <View pointerEvents="none" style={{ position: "absolute", top: 200, left: 216, width: 44, height: 52 }}>
          <Animated.View pointerEvents="none" style={[{ position: "absolute", left: -24, bottom: -6, width: 90, height: 56 }, fireGlowSt]}>
            <Svg width={90} height={56}>
              <Defs>
                <RadialGradient id="fireGlowG" cx="50%" cy="50%" r="50%">
                  <Stop offset="0" stopColor="#FFAA50" stopOpacity={0.32} />
                  <Stop offset="0.66" stopColor="#FFAA50" stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Ellipse cx={45} cy={28} rx={45} ry={28} fill="url(#fireGlowG)" />
            </Svg>
          </Animated.View>
          <View style={{ position: "absolute", left: 9, bottom: 8, width: 24, height: 8, borderRadius: 4, backgroundColor: "#4A3428", transform: [{ rotate: "16deg" }] }} />
          <View style={{ position: "absolute", left: 9, bottom: 8, width: 24, height: 8, borderRadius: 4, backgroundColor: "#3E2B20", transform: [{ rotate: "-16deg" }] }} />
          <Flame style={{ left: 12, bottom: 13 }} w={17} h={25} colors={["#FFD98A", "#F2933E", "#D86A2E"]} duration={900} />
          <Flame style={{ left: 16, bottom: 13 }} w={9} h={14} colors={["#FFF2C4", "#FFF2C4", "#FFF2C4"]} duration={700} delay={200} />
          <Spark style={{ left: 16, bottom: 36 }} s={2.5} color="#FFCE7A" duration={1700} />
          <Spark style={{ left: 24, bottom: 34 }} s={2} color="#FFB95C" duration={2100} delay={800} />
        </View>
      </SceneCanvas>
      {/* 파도 거품(어두운 톤) — 카드 전폭. 수면 위치는 씬 좌표(236/286) × 스케일로 환산 */}
      <View
        pointerEvents="none"
        style={{ position: "absolute", bottom: (SCENE_H - 236) * p.scale, left: 0, right: 0, height: 40, overflow: "hidden" }}>
        <Animated.View
          style={[
            { position: "absolute", bottom: 16, left: "-6%", width: "120%", height: 13, borderRadius: 999, backgroundColor: "rgba(190,208,245,0.14)" },
            waveASt,
          ]}
        />
        <Animated.View
          style={[
            { position: "absolute", bottom: 2, left: "-4%", width: "130%", height: 12, borderRadius: 999, backgroundColor: "rgba(190,208,245,0.1)" },
            waveBSt,
          ]}
        />
      </View>
    </>
  );
}
