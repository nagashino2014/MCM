/**
 * 씬 공용 파츠 — 웹 WeatherWidget 의 3층 렌더 구조를 RN 으로 옮긴 것.
 *
 *  ① SceneBand   풍경 밴드(바다·모래·언덕·눈밭): preserveAspectRatio="none" 으로 카드 폭에 꽉 채움
 *  ② SceneCanvas 오브젝트 캔버스(400×286): 통째 scale — 인물·나무·건물이 왜곡되지 않는다
 *  ③ 파티클      비·눈·꽃잎·낙엽: 카드 전폭에 뿌린다
 *
 * 웹이 CSS(배경 gradient·box-shadow·drop-shadow)로 처리한 표현은 RN 에 없으므로
 * **SVG gradient 로 옮기고**, 그림자류는 생략한다(168px 카드에서 체감 차이가 없다).
 */
import { type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedProps, useAnimatedStyle } from "react-native-reanimated";
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";

import { phase, useLinearLoop, usePingPong } from "./anim";
import { SCENE_H, SCENE_W } from "./rules";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedRect = Animated.createAnimatedComponent(Rect);

export interface SceneProps {
  /** 카드 실측 폭. */
  w: number;
  /** 카드 실측 높이. */
  h: number;
  /** 400×286 캔버스 → 카드 스케일. */
  scale: number;
}

/** ② 오브젝트 캔버스 — 400×286 좌표계를 통째로 스케일한다(비왜곡). */
export function SceneCanvas({
  w,
  h,
  scale,
  anchor = "bottom",
  children,
}: SceneProps & { anchor?: "bottom" | "topRight"; children: ReactNode }) {
  // 캔버스를 카드 중앙에 놓고(left/top), transform 으로 기준점(하단중앙/우상단)에 맞춘다.
  // RN 의 transform 기준점은 항상 요소 중심이라 CSS 의 transform-origin 대신 평행이동으로 푼다.
  const shift =
    anchor === "topRight"
      ? [{ translateX: w / 2 - (SCENE_W / 2) * scale }, { translateY: -h / 2 + (SCENE_H / 2) * scale }]
      : [{ translateY: h / 2 - (SCENE_H / 2) * scale }];
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: (w - SCENE_W) / 2,
        top: (h - SCENE_H) / 2,
        width: SCENE_W,
        height: SCENE_H,
        transform: [...shift, { scale }],
      }}>
      {children}
    </View>
  );
}

/** ① 풍경 밴드 — 지면·수면을 카드 폭에 꽉 채운다(가로 스트레치, 세로는 캔버스 스케일과 동기). */
export function SceneBand({
  w,
  scale,
  vbH,
  children,
}: {
  w: number;
  scale: number;
  vbH: number;
  children: ReactNode;
}) {
  return (
    <Svg
      pointerEvents="none"
      style={{ position: "absolute", left: 0, bottom: 0 }}
      width={w}
      height={vbH * scale}
      viewBox={`0 0 ${SCENE_W} ${vbH}`}
      preserveAspectRatio="none">
      {children}
    </Svg>
  );
}

/** 반짝임(cdTwinkle) — opacity 1 ↔ 0.2. */
export function Twinkle({
  cx,
  cy,
  r,
  fill,
  duration = 3000,
  delay = 0,
}: {
  cx: number;
  cy: number;
  r: number;
  fill: string;
  duration?: number;
  delay?: number;
}) {
  const p = usePingPong(duration, delay);
  const props = useAnimatedProps(() => ({ opacity: 1 - 0.8 * p.value }));
  return <AnimatedCircle cx={cx} cy={cy} r={r} fill={fill} animatedProps={props} />;
}

/** 반짝이는 사각(창문·물비늘) — Twinkle 의 rect 판. */
export function TwinkleRect({
  x,
  y,
  width,
  height,
  rx,
  fill,
  duration = 3000,
  delay = 0,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
  fill: string;
  duration?: number;
  delay?: number;
}) {
  const p = usePingPong(duration, delay);
  const props = useAnimatedProps(() => ({ opacity: 1 - 0.8 * p.value }));
  return <AnimatedRect x={x} y={y} width={width} height={height} rx={rx} fill={fill} animatedProps={props} />;
}

/** 좌우 흔들림(cdSway·cdTreeSway·cdReed) — 하단 중심 회전. */
export function Sway({
  deg,
  duration,
  style,
  origin = "50% 100%",
  children,
}: {
  /** ±각도. */
  deg: number | [number, number];
  duration: number;
  style: StyleProp<ViewStyle>;
  /** 회전 기준(CSS transform-origin 문법). 기본은 줄기 아래. */
  origin?: string;
  children: ReactNode;
}) {
  const p = usePingPong(duration);
  const [from, to] = Array.isArray(deg) ? deg : [-deg, deg];
  const st = useAnimatedStyle(() => ({
    transform: [{ rotate: `${from + (to - from) * p.value}deg` }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", transformOrigin: origin }, style, st]}>
      {children}
    </Animated.View>
  );
}

/** 가로 부유(cdCloudA/B) — 구름·안개. */
export function Drift({
  from,
  to,
  duration,
  style,
  children,
}: {
  from: number;
  to: number;
  duration: number;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const p = usePingPong(duration);
  const st = useAnimatedStyle(() => ({ transform: [{ translateX: from + (to - from) * p.value }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute" }, style, st]}>
      {children}
    </Animated.View>
  );
}

/** 상하 부유(cdFloat). */
export function Float({
  dy,
  duration,
  style,
  children,
}: {
  dy: number;
  duration: number;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const p = usePingPong(duration);
  const st = useAnimatedStyle(() => ({ transform: [{ translateY: dy * p.value }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute" }, style, st]}>
      {children}
    </Animated.View>
  );
}

/** 둥근 뭉게구름 — 바닥 캡슐 + 원 1~2개(웹 Cloud 와 같은 구조, 채움만 SVG gradient). */
export function Cloud({
  id,
  style,
  w,
  h,
  base,
  puffs,
  drift,
  opacity,
}: {
  id: string;
  style: StyleProp<ViewStyle>;
  w: number;
  h: number;
  base: { w: number; h: number; c: [string, string] };
  puffs: { b: number; l: number; s: number; c: [string, string] }[];
  drift: { from: number; to: number; duration: number };
  opacity?: number;
}) {
  return (
    <Drift {...drift} style={[{ width: w, height: h, opacity }, style]}>
      <Svg width={w} height={h}>
        <Defs>
          <LinearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={base.c[0]} />
            <Stop offset="1" stopColor={base.c[1]} />
          </LinearGradient>
          {puffs.map((p, i) => (
            <LinearGradient key={i} id={`${id}p${i}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={p.c[0]} />
              <Stop offset="1" stopColor={p.c[1]} />
            </LinearGradient>
          ))}
        </Defs>
        <Rect x={0} y={h - base.h} width={base.w} height={base.h} rx={base.h / 2} fill={`url(#${id}b)`} />
        {puffs.map((p, i) => (
          <Circle key={i} cx={p.l + p.s / 2} cy={h - p.b - p.s / 2} r={p.s / 2} fill={`url(#${id}p${i})`} />
        ))}
      </Svg>
    </Drift>
  );
}

/** 태양 — 후광 + 회전 광선 + 펄스 코어(맑음·여름휴가 공용). */
export function Sun({
  glow,
  ray,
  core,
}: {
  glow: { top: number; right: number; size: number };
  ray: { top: number; right: number; size: number };
  core: { top: number; right: number; size: number };
}) {
  const spin = useLinearLoop(26_000);
  const pulse = usePingPong(3800);
  const spinSt = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));
  const coreSt = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.07 * pulse.value }] }));

  return (
    <>
      <View
        pointerEvents="none"
        style={{ position: "absolute", top: glow.top, right: glow.right, width: glow.size, height: glow.size }}>
        <Svg width={glow.size} height={glow.size}>
          <Defs>
            <RadialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#FFCE6E" stopOpacity={0.42} />
              <Stop offset="0.68" stopColor="#FFCE6E" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={glow.size / 2} cy={glow.size / 2} r={glow.size / 2} fill="url(#sunGlow)" />
        </Svg>
      </View>
      <Animated.View
        pointerEvents="none"
        style={[
          { position: "absolute", top: ray.top, right: ray.right, width: ray.size, height: ray.size, opacity: 0.85 },
          spinSt,
        ]}>
        <Svg width={ray.size} height={ray.size} viewBox="0 0 68 68">
          <G stroke="#F0AC3F" strokeWidth={3.2} strokeLinecap="round">
            <Line x1={34} y1={3} x2={34} y2={12} />
            <Line x1={34} y1={56} x2={34} y2={65} />
            <Line x1={3} y1={34} x2={12} y2={34} />
            <Line x1={56} y1={34} x2={65} y2={34} />
          </G>
          <G stroke="#F0AC3F" strokeWidth={3.2} strokeLinecap="round" transform="rotate(45 34 34)">
            <Line x1={34} y1={3} x2={34} y2={12} />
            <Line x1={34} y1={56} x2={34} y2={65} />
            <Line x1={3} y1={34} x2={12} y2={34} />
            <Line x1={56} y1={34} x2={65} y2={34} />
          </G>
        </Svg>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          { position: "absolute", top: core.top, right: core.right, width: core.size, height: core.size },
          coreSt,
        ]}>
        <Svg width={core.size} height={core.size}>
          <Defs>
            <RadialGradient id="sunCore" cx="32%" cy="30%" r="70%">
              <Stop offset="0" stopColor="#FFEBB8" />
              <Stop offset="0.62" stopColor="#F7B94E" />
              <Stop offset="1" stopColor="#EE9E2E" />
            </RadialGradient>
          </Defs>
          <Circle cx={core.size / 2} cy={core.size / 2} r={core.size / 2} fill="url(#sunCore)" />
        </Svg>
      </Animated.View>
    </>
  );
}

// ── 낙하 파티클 ──────────────────────────────────────────────────────────────
// 웹은 요소마다 음수 animation-delay 로 위상을 흩었다. RN 은 주기별 루프 1개를 공유하고
// 위상 오프셋만 요소별로 다르게 준다(타이머 수를 파티클 수에서 주기 수로 줄인다).

/** 빗줄기 1개(cdRain). */
function RainDrop({ p, offset, left, height }: { p: { value: number }; offset: number; left: number; height: number }) {
  const st = useAnimatedStyle(() => {
    const t = phase(p.value, offset);
    return {
      transform: [{ translateY: -16 + 110 * t }],
      opacity: t < 0.1 ? t * 10 : t > 0.8 ? (1 - t) * 5 : 1,
    };
  });
  return (
    <Animated.View
      style={[
        { position: "absolute", top: 0, left: `${left}%`, width: 2, height, borderRadius: 2, backgroundColor: "rgba(90,120,220,0.62)" },
        st,
      ]}
    />
  );
}

const RAINS = Array.from({ length: 10 }, (_, i) => ({
  l: 3 + i * 10,
  h: 9 + (i % 3) * 4,
  group: i % 3,
  off: (i * 0.19) % 1,
}));

export function RainLayer({ style }: { style: StyleProp<ViewStyle> }) {
  const loops = [useLinearLoop(1000), useLinearLoop(1140), useLinearLoop(1280)];
  return (
    <View pointerEvents="none" style={[{ position: "absolute", overflow: "hidden" }, style]}>
      {RAINS.map((r, i) => (
        <RainDrop key={i} p={loops[r.group]} offset={r.off} left={r.l} height={r.h} />
      ))}
    </View>
  );
}

/** 눈송이 1개(cdSnow / cdSnowTall) — 좌우로 흔들리며 낙하. */
function SnowFlake({
  p,
  offset,
  left,
  size,
  opacity,
  tall,
}: {
  p: { value: number };
  offset: number;
  left: number;
  size: number;
  opacity: number;
  tall?: boolean;
}) {
  const st = useAnimatedStyle(() => {
    const t = phase(p.value, offset);
    // 웹 keyframes 의 (dx, dy) 구간을 선형 보간으로 근사한다.
    const ks = tall
      ? [
          [0, 0, -10],
          [0.3, 8, 58],
          [0.55, -6, 116],
          [0.8, 7, 168],
          [1, -2, 214],
        ]
      : [
          [0, 0, -10],
          [0.3, 7, 22],
          [0.55, -5, 48],
          [0.8, 6, 72],
          [1, -2, 94],
        ];
    let x = 0;
    let y = 0;
    for (let i = 1; i < ks.length; i += 1) {
      if (t <= ks[i][0] || i === ks.length - 1) {
        const r = (t - ks[i - 1][0]) / (ks[i][0] - ks[i - 1][0]);
        x = ks[i - 1][1] + (ks[i][1] - ks[i - 1][1]) * r;
        y = ks[i - 1][2] + (ks[i][2] - ks[i - 1][2]) * r;
        break;
      }
    }
    const fadeIn = tall ? 0.08 : 0.12;
    return {
      transform: [{ translateX: x }, { translateY: y }],
      opacity: t < fadeIn ? t / fadeIn : t > 0.8 ? (1 - t) * 5 : 1,
    };
  });
  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          top: 0,
          left: `${left}%`,
          width: size,
          height: size,
          borderRadius: 999,
          backgroundColor: `rgba(255,255,255,${opacity})`,
        },
        st,
      ]}
    />
  );
}

const SNOWS = Array.from({ length: 12 }, (_, i) => ({
  l: 2 + i * 8.5,
  s: 3 + (i % 4),
  o: 0.55 + (i % 3) * 0.2,
  group: i % 4,
  off: (i * 0.55) % 1,
}));

export function SnowLayer({ style, tall }: { style: StyleProp<ViewStyle>; tall?: boolean }) {
  const loops = [useLinearLoop(2600), useLinearLoop(3100), useLinearLoop(3600), useLinearLoop(4100)];
  return (
    <View pointerEvents="none" style={[{ position: "absolute", overflow: "hidden" }, style]}>
      {SNOWS.map((s, i) => (
        <SnowFlake key={i} p={loops[s.group]} offset={s.off} left={s.l} size={s.s} opacity={s.o} tall={tall} />
      ))}
    </View>
  );
}

/** 회전하며 떨어지는 잎·꽃잎 1개(cdPetal / cdLeafBig). */
function Flutter({
  p,
  offset,
  left,
  w,
  h,
  color,
  radius,
  keys,
}: {
  p: { value: number };
  offset: number;
  left: number;
  w: number;
  h: number;
  color: string;
  radius: string;
  keys: number[][];
}) {
  const st = useAnimatedStyle(() => {
    const t = phase(p.value, offset);
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
  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          top: 0,
          left: `${left}%`,
          width: w,
          height: h,
          backgroundColor: color,
          borderTopLeftRadius: Number(radius.split(" ")[0]),
          borderTopRightRadius: Number(radius.split(" ")[1]),
          borderBottomRightRadius: Number(radius.split(" ")[2]),
          borderBottomLeftRadius: Number(radius.split(" ")[3]),
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

const PETALS = Array.from({ length: 14 }, (_, i) => ({
  l: 2 + i * 7,
  s: 6 + (i % 3),
  s2: 5 + (i % 2) * 2,
  c: ["#F7C7D4", "#F4B7C8", "#F0A9BE"][i % 3],
  group: i % 4,
  off: (i * 0.62) % 1,
}));

export function PetalLayer({ style }: { style: StyleProp<ViewStyle> }) {
  const loops = [useLinearLoop(4400), useLinearLoop(5100), useLinearLoop(5800), useLinearLoop(6500)];
  return (
    <View pointerEvents="none" style={[{ position: "absolute", overflow: "hidden" }, style]}>
      {PETALS.map((p, i) => (
        <Flutter
          key={i}
          p={loops[p.group]}
          offset={p.off}
          left={p.l}
          w={p.s}
          h={p.s2}
          color={p.c}
          // 웹의 border-radius: 60% 40% 55% 45% 를 px 근사(요소가 6~8px 라 시각차 없음)
          radius="4 3 4 3"
          keys={PETAL_KEYS}
        />
      ))}
    </View>
  );
}

const MAPLES = Array.from({ length: 9 }, (_, i) => ({
  l: 3 + i * 11,
  c: ["#D45C33", "#E7A14E", "#C94B2E", "#DB7B3C", "#B0432A"][i % 5],
  group: i % 4,
  off: (i * 0.7) % 1,
}));

export function MapleLayer({ style, count = 9, size = 1 }: { style: StyleProp<ViewStyle>; count?: number; size?: number }) {
  const loops = [useLinearLoop(4600), useLinearLoop(5200), useLinearLoop(5800), useLinearLoop(6400)];
  return (
    <View pointerEvents="none" style={[{ position: "absolute", overflow: "hidden" }, style]}>
      {MAPLES.slice(0, count).map((m, i) => (
        <Flutter
          key={i}
          p={loops[m.group]}
          offset={m.off}
          left={m.l}
          w={14 * size}
          h={11 * size}
          color={m.c}
          radius="9 5 8 6"
          keys={LEAF_KEYS}
        />
      ))}
    </View>
  );
}

/** 하늘의 새 2마리 — 봄·가을 공용. */
export function SkyBirds({ stroke = "#9AA1B8" }: { stroke?: string }) {
  return (
    <Svg style={{ position: "absolute", left: 0, bottom: 0 }} width={SCENE_W} height={240} viewBox="0 0 400 240">
      <Path d="M66 52 q7 -8 15 0 M92 42 q7 -8 15 0" stroke={stroke} strokeWidth={2.2} fill="none" strokeLinecap="round" />
    </Svg>
  );
}
