/** 계절 씬 3종 — 봄·가을·여름휴가(맑음일 때만 나온다). 웹 WeatherWidget 과 좌표·색 동일. */
import { View } from "react-native";
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from "react-native-svg";

import {
  Float,
  MapleLayer,
  PetalLayer,
  SceneBand,
  SceneCanvas,
  SkyBirds,
  Sun,
  Sway,
  Twinkle,
  TwinkleRect,
  type SceneProps,
} from "./parts";
import { SCENE_H, SCENE_W } from "./rules";
import { useLinearLoop, usePingPong } from "./anim";
import Animated, { useAnimatedStyle } from "react-native-reanimated";

// ── 벚나무/단풍나무 — 줄기 + 원형 캐노피(색만 다르다) ──────────────────────────
export interface Canopy {
  cx: number;
  cy: number;
  r: number;
  f: string;
}
export interface TwinkleDot {
  cx: number;
  cy: number;
  r: number;
  f: string;
  sp: number;
  delay?: number;
}

export function SceneTree({ trunk, canopy, twinkle }: { trunk: string; canopy: Canopy[]; twinkle: TwinkleDot[] }) {
  return (
    <G>
      <Path
        d="M112 200 C106 154 116 120 98 82 M110 146 C82 126 66 110 58 90 M112 118 C136 100 152 90 162 72 M111 166 C126 157 136 151 146 144"
        stroke={trunk}
        strokeWidth={8}
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d="M76 106 C66 96 60 88 58 78 M144 98 C154 88 158 80 160 72"
        stroke={trunk}
        strokeWidth={4}
        fill="none"
        strokeLinecap="round"
      />
      {canopy.map((c, i) => (
        <Circle key={i} cx={c.cx} cy={c.cy} r={c.r} fill={c.f} />
      ))}
      {twinkle.map((t, i) => (
        <Twinkle key={`t${i}`} cx={t.cx} cy={t.cy} r={t.r} fill={t.f} duration={t.sp} delay={t.delay} />
      ))}
    </G>
  );
}

const SPRING_CANOPY: Canopy[] = [
  { cx: 52, cy: 78, r: 17, f: "#F4B7C8" }, { cx: 78, cy: 58, r: 21, f: "#F7C7D4" }, { cx: 108, cy: 46, r: 24, f: "#F4B7C8" },
  { cx: 140, cy: 52, r: 22, f: "#F7C7D4" }, { cx: 164, cy: 68, r: 19, f: "#F4B7C8" }, { cx: 178, cy: 92, r: 16, f: "#F0A9BE" },
  { cx: 96, cy: 74, r: 18, f: "#F0A9BE" }, { cx: 126, cy: 70, r: 19, f: "#F7C7D4" }, { cx: 152, cy: 86, r: 17, f: "#F4B7C8" },
  { cx: 66, cy: 96, r: 15, f: "#F7C7D4" }, { cx: 88, cy: 92, r: 14, f: "#F4B7C8" }, { cx: 118, cy: 88, r: 16, f: "#F0A9BE" },
  { cx: 142, cy: 104, r: 14, f: "#F7C7D4" }, { cx: 168, cy: 114, r: 12, f: "#F0A9BE" }, { cx: 104, cy: 60, r: 15, f: "#F7C7D4" },
  { cx: 58, cy: 60, r: 13, f: "#F4B7C8" }, { cx: 150, cy: 138, r: 13, f: "#F4B7C8" }, { cx: 162, cy: 146, r: 10, f: "#F7C7D4" },
  { cx: 144, cy: 150, r: 9, f: "#F0A9BE" }, { cx: 100, cy: 50, r: 9, f: "#FBDCE5" }, { cx: 134, cy: 58, r: 8, f: "#FBDCE5" },
  { cx: 72, cy: 66, r: 7, f: "#FBDCE5" }, { cx: 158, cy: 76, r: 7, f: "#FBDCE5" }, { cx: 90, cy: 80, r: 6, f: "#FBDCE5" },
];
const SPRING_TWINKLE: TwinkleDot[] = [
  { cx: 112, cy: 66, r: 3.2, f: "#EC93AD", sp: 3000 },
  { cx: 146, cy: 72, r: 3.2, f: "#EC93AD", sp: 3600, delay: 800 },
  { cx: 74, cy: 82, r: 2.8, f: "#EC93AD", sp: 3200, delay: 1600 },
  { cx: 170, cy: 96, r: 2.8, f: "#EC93AD", sp: 3400, delay: 2200 },
];
const AUTUMN_CANOPY: Canopy[] = [
  { cx: 52, cy: 78, r: 17, f: "#E7A14E" }, { cx: 78, cy: 58, r: 21, f: "#DB7B3C" }, { cx: 108, cy: 46, r: 24, f: "#D45C33" },
  { cx: 140, cy: 52, r: 22, f: "#DB7B3C" }, { cx: 164, cy: 68, r: 19, f: "#C94B2E" }, { cx: 178, cy: 92, r: 16, f: "#D45C33" },
  { cx: 96, cy: 74, r: 18, f: "#C94B2E" }, { cx: 126, cy: 70, r: 19, f: "#E7A14E" }, { cx: 152, cy: 86, r: 17, f: "#DB7B3C" },
  { cx: 66, cy: 96, r: 15, f: "#D45C33" }, { cx: 88, cy: 92, r: 14, f: "#DB7B3C" }, { cx: 118, cy: 88, r: 16, f: "#C94B2E" },
  { cx: 142, cy: 104, r: 14, f: "#E7A14E" }, { cx: 168, cy: 114, r: 12, f: "#DB7B3C" }, { cx: 104, cy: 60, r: 15, f: "#E7A14E" },
  { cx: 58, cy: 60, r: 13, f: "#DB7B3C" }, { cx: 150, cy: 138, r: 13, f: "#DB7B3C" }, { cx: 162, cy: 146, r: 10, f: "#E7A14E" },
  { cx: 144, cy: 150, r: 9, f: "#C94B2E" }, { cx: 100, cy: 50, r: 9, f: "#F2C48E" }, { cx: 134, cy: 58, r: 8, f: "#F2C48E" },
  { cx: 72, cy: 66, r: 7, f: "#F2C48E" }, { cx: 158, cy: 76, r: 7, f: "#F2C48E" },
];
const AUTUMN_TWINKLE: TwinkleDot[] = [
  { cx: 112, cy: 66, r: 3.4, f: "#B0432A", sp: 3400 },
  { cx: 146, cy: 72, r: 3.4, f: "#B0432A", sp: 3800, delay: 1000 },
  { cx: 74, cy: 82, r: 3, f: "#B0432A", sp: 3600, delay: 1800 },
];

/** 나무 한 그루(스웨이 포함) — 큰 나무/뒤쪽 작은 나무가 같은 그림을 쓴다. */
export function TreeSprite({
  size,
  style,
  duration,
  opacity,
  trunk,
  canopy,
  twinkle,
}: {
  size: [number, number];
  style: { top: number; right: number };
  duration: number;
  opacity?: number;
  trunk: string;
  canopy: Canopy[];
  twinkle: TwinkleDot[];
}) {
  return (
    <Sway
      deg={1.3}
      duration={duration}
      origin="58% 100%"
      style={{ ...style, width: size[0], height: size[1], opacity }}>
      <Svg width={size[0]} height={size[1]} viewBox="0 0 200 204">
        <SceneTree trunk={trunk} canopy={canopy} twinkle={twinkle} />
      </Svg>
    </Sway>
  );
}

export function SpringScene(p: SceneProps) {
  return (
    <>
      <SceneBand w={p.w} scale={p.scale} vbH={240}>
        <Path d="M0 186 Q100 162 210 178 T400 172 L400 240 L0 240 Z" fill="rgba(172,216,140,0.55)" />
        <Path d="M0 208 Q120 196 240 204 T400 200 L400 240 L0 240 Z" fill="rgba(193,229,152,0.85)" />
        <Ellipse cx={240} cy={214} rx={5} ry={2.4} fill="rgba(244,183,200,0.85)" />
        <Ellipse cx={268} cy={220} rx={4.5} ry={2.2} fill="rgba(240,169,190,0.8)" />
        <Ellipse cx={312} cy={216} rx={5} ry={2.4} fill="rgba(247,199,212,0.9)" />
        <Ellipse cx={204} cy={218} rx={4} ry={2} fill="rgba(244,183,200,0.7)" />
        <Ellipse cx={352} cy={220} rx={5} ry={2.2} fill="rgba(244,183,200,0.8)" />
        <Path
          d="M64 208 q2 -9 6 -11 M76 210 q1 -8 5 -10 M158 206 q2 -9 6 -11 M170 208 q2 -8 5 -10"
          stroke="#7FB85C"
          strokeWidth={2.2}
          fill="none"
          strokeLinecap="round"
        />
      </SceneBand>
      <SceneCanvas {...p}>
        <SkyBirds />
        <TreeSprite
          size={[120, 122]}
          style={{ top: 132, right: 116 }}
          duration={7200}
          opacity={0.95}
          trunk="#8A5A48"
          canopy={SPRING_CANOPY}
          twinkle={SPRING_TWINKLE}
        />
        <TreeSprite
          size={[180, 184]}
          style={{ top: 74, right: 6 }}
          duration={6000}
          trunk="#8A5A48"
          canopy={SPRING_CANOPY}
          twinkle={SPRING_TWINKLE}
        />
        {/* 들꽃 */}
        <Float dy={-9} duration={3400} style={{ top: 156, left: 52, width: 20, height: 15 }}>
          <Svg width={20} height={15} viewBox="0 0 20 15">
            <Ellipse cx={6} cy={7} rx={5.5} ry={5} fill="#E8A0C0" transform="rotate(-18 6 7)" />
            <Ellipse cx={14} cy={7} rx={5.5} ry={5} fill="#F0B8D0" transform="rotate(18 14 7)" />
            <Rect x={9.2} y={2.5} width={1.8} height={10} rx={0.9} fill="#7A4E62" />
          </Svg>
        </Float>
      </SceneCanvas>
      <PetalLayer style={{ top: 44, left: 0, right: 0, bottom: 0 }} />
    </>
  );
}

/** 가을 갈대 — 위치·높이만 다른 7개. */
const REEDS: { top: number; left?: number; right?: number; h: number; soft?: boolean; dark?: boolean; ear: string; side?: "l" | "r" }[] = [
  { top: 194, left: 128, h: 70, ear: "#C9A96E", side: "l" },
  { top: 202, left: 152, h: 62, soft: true, ear: "#D9BC85", side: "r" },
  { top: 192, left: 176, h: 72, dark: true, ear: "#C9A96E" },
  { top: 198, right: 4, h: 66, soft: true, ear: "#D9BC85", side: "l" },
  { top: 200, left: 106, h: 56, soft: true, ear: "#C9A96E" },
  { top: 196, left: 206, h: 60, dark: true, ear: "#D9BC85" },
  { top: 200, right: 34, h: 58, soft: true, ear: "#C9A96E", side: "r" },
];

export function AutumnScene(p: SceneProps) {
  const gull = usePingPong(6000);
  const gullSt = useAnimatedStyle(() => ({
    transform: [{ translateX: 24 * gull.value }, { translateY: -8 * gull.value }],
  }));

  return (
    <>
      <SceneBand w={p.w} scale={p.scale} vbH={240}>
        <Path d="M0 186 Q100 162 210 178 T400 172 L400 240 L0 240 Z" fill="rgba(235,205,160,0.42)" />
        <Path d="M0 208 Q120 196 240 204 T400 200 L400 240 L0 240 Z" fill="rgba(244,226,196,0.75)" />
        <Ellipse cx={238} cy={214} rx={7} ry={3} fill="rgba(212,92,51,0.85)" />
        <Ellipse cx={268} cy={220} rx={6} ry={2.8} fill="rgba(231,161,78,0.85)" />
        <Ellipse cx={310} cy={216} rx={7} ry={3} fill="rgba(201,75,46,0.85)" />
        <Ellipse cx={204} cy={218} rx={6} ry={2.6} fill="rgba(219,123,60,0.75)" />
        <Ellipse cx={352} cy={220} rx={6} ry={2.6} fill="rgba(212,92,51,0.7)" />
        <Ellipse cx={128} cy={216} rx={5.5} ry={2.4} fill="rgba(231,161,78,0.65)" />
      </SceneBand>
      <SceneCanvas {...p}>
        <SkyBirds />
        <TreeSprite
          size={[120, 122]}
          style={{ top: 132, right: 116 }}
          duration={7500}
          opacity={0.95}
          trunk="#7A5238"
          canopy={AUTUMN_CANOPY}
          twinkle={AUTUMN_TWINKLE}
        />
        <TreeSprite
          size={[180, 184]}
          style={{ top: 74, right: 6 }}
          duration={6000}
          trunk="#7A5238"
          canopy={AUTUMN_CANOPY}
          twinkle={AUTUMN_TWINKLE}
        />
        {REEDS.map((r, i) => (
          <Sway
            key={i}
            deg={r.soft ? [-4, 5] : [-7, 8]}
            duration={3600}
            style={{ top: r.top, left: r.left, right: r.right, width: 26, height: r.h }}>
            <Svg width={26} height={r.h} viewBox="0 0 26 70">
              <Path
                d={i % 2 ? "M13 70 Q14 34 12 12" : "M13 70 Q12 34 14 12"}
                stroke={r.dark ? "#A8834E" : "#B8935A"}
                strokeWidth={2.5}
                fill="none"
                strokeLinecap="round"
              />
              <Ellipse cx={i % 2 ? 12 : 14} cy={12} rx={4.5} ry={11} fill={r.ear} />
              {r.side === "l" ? (
                <Path d="M13 46 q-8 -4 -11 -12" stroke="#B8935A" strokeWidth={2} fill="none" strokeLinecap="round" />
              ) : null}
              {r.side === "r" ? (
                <Path d="M13 48 q8 -4 11 -12" stroke="#B8935A" strokeWidth={2} fill="none" strokeLinecap="round" />
              ) : null}
            </Svg>
          </Sway>
        ))}
        {/* 갈매기 */}
        <Animated.View
          pointerEvents="none"
          style={[{ position: "absolute", top: 166, left: 52, width: 26, height: 12 }, gullSt]}>
          <Svg width={26} height={12} viewBox="0 0 26 12">
            <Ellipse cx={8} cy={4} rx={7} ry={2.6} fill="rgba(180,210,235,0.85)" transform="rotate(-14 8 4)" />
            <Ellipse cx={8} cy={8} rx={7} ry={2.6} fill="rgba(180,210,235,0.7)" transform="rotate(14 8 8)" />
            <Rect x={10} y={5} width={14} height={2} rx={1} fill="#C05A38" />
            <Circle cx={10.5} cy={6} r={2.2} fill="#A34A2E" />
          </Svg>
        </Animated.View>
      </SceneCanvas>
      <MapleLayer style={{ top: 44, left: 0, right: 0, bottom: 0 }} />
    </>
  );
}

export function SummerScene(p: SceneProps) {
  const sail = useLinearLoop(20_000);
  const bob = usePingPong(4000);
  const roll = usePingPong(5000);
  const waveA = usePingPong(6000);
  const waveB = usePingPong(8000);

  const sailSt = useAnimatedStyle(() => ({ transform: [{ translateX: -100 + 580 * sail.value }] }));
  const bobSt = useAnimatedStyle(() => ({
    transform: [{ translateY: -5 * bob.value }, { rotate: `${-2.5 + 5 * bob.value}deg` }],
  }));
  const rollSt = useAnimatedStyle(() => ({
    transform: [{ translateX: 11 * roll.value }, { rotate: `${42 * roll.value}deg` }],
  }));
  const waveASt = useAnimatedStyle(() => ({ transform: [{ translateX: -12 + 24 * waveA.value }] }));
  const waveBSt = useAnimatedStyle(() => ({ transform: [{ translateX: 12 - 24 * waveB.value }] }));

  return (
    <>
      <SceneBand w={p.w} scale={p.scale} vbH={SCENE_H}>
        <Defs>
          <LinearGradient id="wSeaGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#6BC1E8" />
            <Stop offset="1" stopColor="#3E9BD6" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={156} width={400} height={74} fill="url(#wSeaGrad)" />
        <Rect x={0} y={156} width={400} height={3} fill="rgba(255,255,255,0.55)" />
        <TwinkleRect x={80} y={180} width={12} height={2.6} rx={1.3} fill="rgba(255,255,255,0.8)" duration={2400} />
        <TwinkleRect x={180} y={198} width={9} height={2.4} rx={1.2} fill="rgba(255,255,255,0.7)" duration={3000} delay={800} />
        <TwinkleRect x={268} y={174} width={10} height={2.4} rx={1.2} fill="rgba(255,255,255,0.75)" duration={2700} delay={1400} />
        <Path d="M0 230 Q100 216 200 226 T400 222 L400 286 L0 286 Z" fill="#F2DDB0" />
        <Path d="M0 230 Q100 216 200 226 T400 222" stroke="rgba(255,255,255,0.75)" strokeWidth={3} fill="none" />
      </SceneBand>
      <SceneCanvas {...p}>
        {/* 요트 — 가로 항해(sail) 위에 상하 흔들림(bob).
            ★ 바다 위를 지나가므로 **모래밭 전경(야자수·파라솔·비치볼)보다 먼저** 그린다. */}
        <Animated.View pointerEvents="none" style={[{ position: "absolute", top: 148, left: 0, width: 96, height: 56 }, sailSt]}>
          <Animated.View style={[{ width: 96, height: 56 }, bobSt]}>
            <Svg width={96} height={56} viewBox="0 0 96 56">
              <Path
                d="M4 44 q18 6 40 4 M0 50 q26 8 56 4"
                stroke="rgba(255,255,255,0.7)"
                strokeWidth={3}
                fill="none"
                strokeLinecap="round"
              />
              <Ellipse cx={76} cy={46} rx={6} ry={3} fill="rgba(255,255,255,0.8)" />
              <Path d="M52 8 L52 36" stroke="#6E4E3A" strokeWidth={2} />
              <Path d="M52 8 L52 36 L32 36 Z" fill="#FFFFFF" />
              <Path d="M55 12 L55 36 L72 36 Z" fill="#E85D5D" />
              <Path d="M28 38 q22 10 46 0 l-6 10 h-34 z" fill="#C9542F" />
            </Svg>
          </Animated.View>
        </Animated.View>
        <Svg style={{ position: "absolute", left: 0, top: 0 }} width={SCENE_W} height={SCENE_H} viewBox="0 0 400 286">
          <Ellipse cx={300} cy={236} rx={36} ry={5} fill="rgba(180,150,90,0.3)" />
          <Path d="M296 232 C288 192 300 162 286 128" stroke="#9A6B43" strokeWidth={9} fill="none" strokeLinecap="round" />
          <Path
            d="M288 212 q8 4 16 2 M286 190 q8 4 16 2 M288 170 q8 4 15 2 M285 150 q7 3 14 2"
            stroke="#86592F"
            strokeWidth={2.2}
            fill="none"
            strokeLinecap="round"
          />
          <G transform="rotate(-10 352 186)">
            <Path d="M320 188 Q352 150 384 188 Z" fill="#E85D5D" />
            <Path d="M332 186 Q346 156 352 187 Z" fill="#FFFFFF" opacity={0.92} />
            <Path d="M358 187 Q364 156 376 185 Z" fill="#FFFFFF" opacity={0.92} />
            {/* 꼭지 — 갓 곡선의 실제 정점(y≈169)에 붙인다(웹과 동일 보정). */}
            <Path d="M352 172 L352 163" stroke="#8A6240" strokeWidth={3} strokeLinecap="round" />
          </G>
          <Path d="M352 186 L358 232" stroke="#8A6240" strokeWidth={3.5} strokeLinecap="round" />
          <G transform="rotate(-4 375 240)">
            <Rect x={358} y={234} width={34} height={12} rx={3} fill="#5FB6E8" />
            <Path d="M365 236 v9 M374 235 v9 M383 234 v9" stroke="rgba(255,255,255,0.85)" strokeWidth={2.4} />
          </G>
          <Path d="M196 64 q7 -8 15 0 M222 54 q7 -8 15 0" stroke="#7B839C" strokeWidth={2.4} fill="none" strokeLinecap="round" />
        </Svg>
        {/* 야자수 잎 */}
        <Sway deg={6} duration={5000} origin="49% 78%" style={{ top: 70, left: 222, width: 130, height: 74 }}>
          <Svg width={130} height={74} viewBox="0 0 130 74">
            <Path d="M64 58 Q30 40 4 48 Q34 56 66 66 Z" fill="#37A385" />
            <Path d="M64 58 Q42 22 16 16 Q46 36 66 62 Z" fill="#3BAF8E" />
            <Path d="M64 58 Q64 18 48 4 Q72 28 70 60 Z" fill="#2E9678" />
            <Path d="M64 58 Q90 20 116 16 Q90 38 68 62 Z" fill="#3BAF8E" />
            <Path d="M64 58 Q102 40 126 50 Q96 58 64 68 Z" fill="#37A385" />
            <Circle cx={62} cy={66} r={5} fill="#7A5230" />
            <Circle cx={73} cy={62} r={5} fill="#6E4A2A" />
          </Svg>
        </Sway>
        {/* 비치볼 */}
        <Animated.View pointerEvents="none" style={[{ position: "absolute", top: 216, right: 60, width: 20, height: 20 }, rollSt]}>
          <Svg width={20} height={20} viewBox="0 0 20 20">
            <Circle cx={10} cy={10} r={9} fill="#FFFFFF" stroke="#E3E3E3" strokeWidth={1} />
            <Path d="M10 1 A9 9 0 0 1 19 10 L10 10 Z" fill="#E85D5D" />
            <Path d="M10 19 A9 9 0 0 1 1 10 L10 10 Z" fill="#5468C9" />
          </Svg>
        </Animated.View>
      </SceneCanvas>
      <Sun
        glow={{ top: -26, right: -20, size: 150 }}
        ray={{ top: 6, right: 12, size: 58 }}
        core={{ top: 20, right: 26, size: 30 }}
      />
      {/* 파도 거품 — 카드 전폭. 수면 위치는 씬 좌표(236/286) × 스케일로 환산 */}
      <View
        pointerEvents="none"
        style={{ position: "absolute", bottom: (SCENE_H - 236) * p.scale, left: 0, right: 0, height: 40, overflow: "hidden" }}>
        <Animated.View
          style={[
            { position: "absolute", bottom: 16, left: "-6%", width: "120%", height: 13, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.4)" },
            waveASt,
          ]}
        />
        <Animated.View
          style={[
            { position: "absolute", bottom: 2, left: "-4%", width: "130%", height: 12, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.28)" },
            waveBSt,
          ]}
        />
      </View>
    </>
  );
}
