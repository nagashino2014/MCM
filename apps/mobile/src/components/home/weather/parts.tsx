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
function RainDrop({ p, offset, left, height, color }: { p: { value: number }; offset: number; left: number; height: number; color: string }) {
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
        { position: "absolute", top: 0, left: `${left}%`, width: 2, height, borderRadius: 2, backgroundColor: color },
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

/** 빗줄기 레이어 — 주간 rgba(90,120,220) / 야간 rgba(140,170,240)(발광 톤). */
export function RainLayer({ style, color = "rgba(90,120,220,0.62)" }: { style: StyleProp<ViewStyle>; color?: string }) {
  const loops = [useLinearLoop(1000), useLinearLoop(1140), useLinearLoop(1280)];
  return (
    <View pointerEvents="none" style={[{ position: "absolute", overflow: "hidden" }, style]}>
      {RAINS.map((r, i) => (
        <RainDrop key={i} p={loops[r.group]} offset={r.off} left={r.l} height={r.h} color={color} />
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
  glow,
}: {
  p: { value: number };
  offset: number;
  left: number;
  size: number;
  opacity: number;
  tall?: boolean;
  /** 야간 발광 눈송이 — 웹의 box-shadow rgba(200,215,255,0.85) 를 후광 원으로 근사. */
  glow?: boolean;
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
        { position: "absolute", top: 0, left: `${left}%`, width: size, height: size },
        st,
      ]}
    >
      {glow ? (
        <View
          style={{
            position: "absolute",
            left: -size * 0.4,
            top: -size * 0.4,
            width: size * 1.8,
            height: size * 1.8,
            borderRadius: 999,
            backgroundColor: "rgba(200,215,255,0.45)",
          }}
        />
      ) : null}
      <View style={{ width: size, height: size, borderRadius: 999, backgroundColor: `rgba(255,255,255,${opacity})` }} />
    </Animated.View>
  );
}

const SNOWS = Array.from({ length: 12 }, (_, i) => ({
  l: 2 + i * 8.5,
  s: 3 + (i % 4),
  o: 0.55 + (i % 3) * 0.2,
  group: i % 4,
  off: (i * 0.55) % 1,
}));

export function SnowLayer({ style, tall, glow }: { style: StyleProp<ViewStyle>; tall?: boolean; glow?: boolean }) {
  const loops = [useLinearLoop(2600), useLinearLoop(3100), useLinearLoop(3600), useLinearLoop(4100)];
  return (
    <View pointerEvents="none" style={[{ position: "absolute", overflow: "hidden" }, style]}>
      {SNOWS.map((s, i) => (
        <SnowFlake key={i} p={loops[s.group]} offset={s.off} left={s.l} size={s.s} opacity={s.o} tall={tall} glow={glow} />
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

// ── 야간 공용 파츠(핸드오프 야간 공통 규칙 ①·② — 밤하늘·야간 광원) ─────────────────────

/** 트윙클 별 1개 — 웹의 2~3px 원 + cdTwinkle. */
export function NightStar({
  top,
  right,
  s,
  duration,
  delay = 0,
  bright,
}: {
  top: number;
  right: number;
  s: number;
  duration: number;
  delay?: number;
  bright?: boolean;
}) {
  const p = usePingPong(duration, delay);
  const st = useAnimatedStyle(() => ({ opacity: 1 - 0.8 * p.value }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          top,
          right,
          width: s,
          height: s,
          borderRadius: 999,
          backgroundColor: bright ? "#EAF0FF" : "#CBD6F5",
        },
        st,
      ]}
    />
  );
}

/** 십자 반짝이 별(별모양 svg) — 맑은 밤·밤바다의 큰 별. */
export function SparkleStar({
  top,
  right,
  s,
  duration,
  delay = 0,
  fill = "#F2F6FF",
}: {
  top: number;
  right: number;
  s: number;
  duration: number;
  delay?: number;
  fill?: string;
}) {
  const p = usePingPong(duration, delay);
  const st = useAnimatedStyle(() => ({ opacity: 1 - 0.8 * p.value }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", top, right, width: s, height: s }, st]}>
      <Svg width={s} height={s} viewBox="0 0 14 14">
        <Path d="M7 0 L8.3 5.7 L14 7 L8.3 8.3 L7 14 L5.7 8.3 L0 7 L5.7 5.7 Z" fill={fill} />
      </Svg>
    </Animated.View>
  );
}

/** 달 — radial 코어(+크레이터) 와 후광 원. 웹의 box-shadow 글로우는 후광 원으로 근사. */
export function Moon({
  top,
  right,
  s,
  craters,
}: {
  top: number;
  right: number;
  s: number;
  craters?: { t: number; l: number; s: number; o: number }[];
}) {
  const glowS = s * 1.9;
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: top - (glowS - s) / 2, right: right - (glowS - s) / 2, width: glowS, height: glowS }}>
      <Svg width={glowS} height={glowS}>
        <Defs>
          <RadialGradient id="moonGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#F0E6AF" stopOpacity={0.32} />
            <Stop offset="1" stopColor="#F0E6AF" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="moonCore" cx="36%" cy="32%" r="70%">
            <Stop offset="0" stopColor="#FDFBEE" />
            <Stop offset="0.58" stopColor="#EFE7C6" />
            <Stop offset="1" stopColor="#D9CFA6" />
          </RadialGradient>
        </Defs>
        <Circle cx={glowS / 2} cy={glowS / 2} r={glowS / 2} fill="url(#moonGlow)" />
        <Circle cx={glowS / 2} cy={glowS / 2} r={s / 2} fill="url(#moonCore)" />
        {craters?.map((c, i) => (
          <Circle
            key={i}
            cx={(glowS - s) / 2 + c.l + c.s / 2}
            cy={(glowS - s) / 2 + c.t + c.s / 2}
            r={c.s / 2}
            fill={`rgba(200,188,145,${c.o})`}
          />
        ))}
      </Svg>
    </View>
  );
}

/** 달무리(광륜) — cdMoonHalo(opacity 0.55↔1 펄스). */
export function MoonHalo({
  top,
  right,
  s,
  alpha = 0.16,
  duration = 5000,
}: {
  top: number;
  right: number;
  s: number;
  alpha?: number;
  duration?: number;
}) {
  const p = usePingPong(duration);
  const st = useAnimatedStyle(() => ({ opacity: 0.55 + 0.45 * p.value }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", top, right, width: s, height: s }, st]}>
      <Svg width={s} height={s}>
        <Defs>
          <RadialGradient id="haloG" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#F0E8B4" stopOpacity={alpha} />
            <Stop offset="0.66" stopColor="#F0E8B4" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={s / 2} cy={s / 2} r={s / 2} fill="url(#haloG)" />
      </Svg>
    </Animated.View>
  );
}

/** 반딧불 — cdFirefly 궤적(부유 + 명멸) + 노란 후광. */
export function Firefly({
  top,
  left,
  s,
  duration,
  delay = 0,
  soft,
}: {
  top: number;
  left: number;
  s: number;
  duration: number;
  delay?: number;
  soft?: boolean;
}) {
  const p = useLinearLoop(duration, delay);
  const st = useAnimatedStyle(() => {
    const t = p.value;
    // cdFirefly: 0%,100% (0,0)/o0.1 · 22% o1 · 50% (13,-11)/o0.25 · 74% o1
    const x = t < 0.5 ? 13 * (t / 0.5) : 13 * (1 - (t - 0.5) / 0.5);
    const y = t < 0.5 ? -11 * (t / 0.5) : -11 * (1 - (t - 0.5) / 0.5);
    let o: number;
    if (t < 0.22) o = 0.1 + 0.9 * (t / 0.22);
    else if (t < 0.5) o = 1 - 0.75 * ((t - 0.22) / 0.28);
    else if (t < 0.74) o = 0.25 + 0.75 * ((t - 0.5) / 0.24);
    else o = 1 - 0.9 * ((t - 0.74) / 0.26);
    return { transform: [{ translateX: x }, { translateY: y }], opacity: o };
  });
  const glowS = s * 3;
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", top, left, width: s, height: s }, st]}>
      <View
        style={{
          position: "absolute",
          left: -(glowS - s) / 2,
          top: -(glowS - s) / 2,
          width: glowS,
          height: glowS,
          borderRadius: 999,
          backgroundColor: "rgba(255,224,130,0.3)",
        }}
      />
      <View style={{ width: s, height: s, borderRadius: 999, backgroundColor: soft ? "#FFF1BE" : "#FFE9A0" }} />
    </Animated.View>
  );
}

/** 유성 — cdShoot(8s 주기: 62% 대기 → 66% 점등 → 78% 좌하향 이탈). */
export function ShootingStar({ top, right, w = 64 }: { top: number; right: number; w?: number }) {
  const p = useLinearLoop(8000);
  const st = useAnimatedStyle(() => {
    const t = p.value;
    const move = t < 0.62 ? 0 : Math.min(1, (t - 0.62) / 0.16);
    const o = t < 0.62 ? 0 : t < 0.66 ? (t - 0.62) / 0.04 : t < 0.78 ? 1 - (t - 0.66) / 0.12 : 0;
    return { transform: [{ translateX: -130 * move }, { translateY: 66 * move }], opacity: o };
  });
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", top, right, width: w, height: 2 }, st]}>
      <Svg width={w} height={16} style={{ transform: [{ rotate: "-27deg" }] }}>
        <Defs>
          <LinearGradient id="shootG" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={1} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={7} width={w} height={2} rx={1} fill="url(#shootG)" />
      </Svg>
    </Animated.View>
  );
}

/** 모닥불 불꽃 1장(cdFlame) — 스케일 펄스 + 미세 회전. */
export function Flame({
  style,
  w,
  h,
  colors,
  duration,
  delay = 0,
}: {
  style: StyleProp<ViewStyle>;
  w: number;
  h: number;
  /** [상단, 중단, 하단] — 단색이면 같은 값 3개. */
  colors: [string, string, string];
  duration: number;
  delay?: number;
}) {
  const p = useLinearLoop(duration, delay);
  const st = useAnimatedStyle(() => {
    const t = p.value;
    // cdFlame: 0/100% scale(1,1) · 30% (1.1,0.9,-2°) · 60% (0.9,1.08,2°)
    let sx = 1;
    let sy = 1;
    let r = 0;
    if (t < 0.3) {
      const k = t / 0.3;
      sx = 1 + 0.1 * k;
      sy = 1 - 0.1 * k;
      r = -2 * k;
    } else if (t < 0.6) {
      const k = (t - 0.3) / 0.3;
      sx = 1.1 - 0.2 * k;
      sy = 0.9 + 0.18 * k;
      r = -2 + 4 * k;
    } else {
      const k = (t - 0.6) / 0.4;
      sx = 0.9 + 0.1 * k;
      sy = 1.08 - 0.08 * k;
      r = 2 - 2 * k;
    }
    return { transform: [{ translateY: (h / 2) * (1 - sy) }, { scaleX: sx }, { scaleY: sy }, { rotate: `${r}deg` }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", width: w, height: h }, style, st]}>
      <Svg width={w} height={h}>
        <Defs>
          <LinearGradient id="flameG" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors[0]} />
            <Stop offset="0.68" stopColor={colors[1]} />
            <Stop offset="1" stopColor={colors[2]} />
          </LinearGradient>
        </Defs>
        {/* 물방울형 불꽃 — 웹 border-radius 50%/62% 62% 38% 38% 근사 */}
        <Path
          d={`M${w / 2} 0 C ${w * 0.96} ${h * 0.18}, ${w} ${h * 0.55}, ${w} ${h * 0.72} A ${w / 2} ${h * 0.28} 0 1 1 0 ${h * 0.72} C 0 ${h * 0.55}, ${w * 0.04} ${h * 0.18}, ${w / 2} 0 Z`}
          fill="url(#flameG)"
        />
      </Svg>
    </Animated.View>
  );
}

/** 모닥불 불티(cdSpark) — 위로 떠오르며 사라진다. */
export function Spark({
  style,
  s,
  color,
  duration,
  delay = 0,
}: {
  style: StyleProp<ViewStyle>;
  s: number;
  color: string;
  duration: number;
  delay?: number;
}) {
  const p = useLinearLoop(duration, delay);
  const st = useAnimatedStyle(() => {
    const t = p.value;
    return {
      transform: [{ translateY: -32 * t }],
      opacity: t < 0.18 ? t / 0.18 : 1 - (t - 0.18) / 0.82,
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: "absolute", width: s, height: s, borderRadius: 999, backgroundColor: color }, style, st]}
    />
  );
}

/** 원거리 번개(cdFlash) — 7s 주기 이중 섬광(88·91% 점등, 89.5% 반감). */
export function Flash({ style, children }: { style: StyleProp<ViewStyle>; children: ReactNode }) {
  const p = useLinearLoop(7000);
  const st = useAnimatedStyle(() => {
    const t = p.value;
    let o = 0;
    if (t >= 0.86 && t < 0.88) o = (t - 0.86) / 0.02;
    else if (t >= 0.88 && t < 0.895) o = 1 - 0.75 * ((t - 0.88) / 0.015);
    else if (t >= 0.895 && t < 0.91) o = 0.25 + 0.75 * ((t - 0.895) / 0.015);
    else if (t >= 0.91 && t < 0.94) o = 1 - (t - 0.91) / 0.03;
    return { opacity: o };
  });
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute" }, style, st]}>
      {children}
    </Animated.View>
  );
}

/** 널뛰기 널판(cdBoard) — ±6° 시소 회전. jumpers 와 같은 2.4s 주기로 돈다. */
export function SeesawBoard({
  style,
  p,
  children,
}: {
  style: StyleProp<ViewStyle>;
  p: { value: number };
  children: ReactNode;
}) {
  const st = useAnimatedStyle(() => {
    const t = p.value;
    // cdBoard: 0/50/100% 0° · 25% +6° · 75% −6°
    const r = t < 0.25 ? 6 * (t / 0.25) : t < 0.5 ? 6 * (1 - (t - 0.25) / 0.25) : t < 0.75 ? -6 * ((t - 0.5) / 0.25) : -6 * (1 - (t - 0.75) / 0.25);
    return { transform: [{ rotate: `${r}deg` }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute" }, style, st]}>
      {children}
    </Animated.View>
  );
}

/** 널뛰기 점퍼(cdJumpA/B) — 교대 점프. phaseB=true 면 반대 위상. */
export function SeesawJumper({
  style,
  p,
  phaseB,
  children,
}: {
  style: StyleProp<ViewStyle>;
  p: { value: number };
  phaseB?: boolean;
  children: ReactNode;
}) {
  const st = useAnimatedStyle(() => {
    let t = p.value;
    if (phaseB) t = (t + 0.5) % 1;
    // cdJumpA: 0/50/100% 0 · 25% −22px · 75% +3px
    const y = t < 0.25 ? -22 * (t / 0.25) : t < 0.5 ? -22 * (1 - (t - 0.25) / 0.25) : t < 0.75 ? 3 * ((t - 0.5) / 0.25) : 3 * (1 - (t - 0.75) / 0.25);
    return { transform: [{ translateY: y }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute" }, style, st]}>
      {children}
    </Animated.View>
  );
}
