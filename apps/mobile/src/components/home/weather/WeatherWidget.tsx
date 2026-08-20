/**
 * 홈 날씨/시계 위젯 — 데스크탑 위젯의 모바일 이식(핸드오프 2a §2).
 *
 * 카드는 씬 캔버스와 같은 400:286 비율이고, 씬은 카드 폭에 꽉 차게 스케일한다. 씬 위에 얹는 텍스트는
 * 테마 토큰이 아니라 **고정색**이다 — 주간은 밝은 일러스트 위의 잉크색, 야간은 딥 네이비 위의 반전색.
 *
 * 야간 모드(핸드오프 야간 확정안) — 일몰~일출 사이에는 10씬 전부 야간 variant(scenes-night)로 전환:
 * 딥 네이비 캔버스 + 달·별·야간 광원, 텍스트/스크림 반전, 배지는 기상특보성(호우·한파·열대야)만.
 */
import { useMemo, useState } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { CloudyScene, RainScene, SnowScene, SunnyScene } from "./scenes-basic";
import { ChuseokScene, SeolScene, XmasScene } from "./scenes-holiday";
import { AutumnScene, SpringScene, SummerScene } from "./scenes-season";
import {
  NightAutumnScene,
  NightChuseokScene,
  NightCloudyScene,
  NightRainScene,
  NightSeolScene,
  NightSnowScene,
  NightSpringScene,
  NightSummerScene,
  NightSunnyScene,
  NightXmasScene,
} from "./scenes-night";
import { type SceneProps } from "./parts";
import { SCENE_H, SCENE_META, SCENE_W, isNightAt, nightBadge, pickScene, type BaseKind, type SceneKind } from "./rules";
import { useClock, useWeather } from "./use-weather";

/**
 * 카드에 담는 씬 세로 범위 — 캔버스 286 의 **90%**(폭은 항상 400 전부).
 *
 * 핸드오프의 높이 168px 고정은 씬(400×286)을 반 넘게 잘라내 좌우 여백만 남겼고,
 * 반대로 286 을 통째로 담으면 홈에서 위젯이 너무 커진다(둘 다 2026-08-06 실측 확인).
 * 그래서 폭은 꽉 채우고 **위쪽 29px 만 잘라낸다** — 하늘 씬은 원래 그 영역이 비어 있고,
 * 지면 씬 중 그 자리에 오브젝트가 있던 설날 연·추석 감나무는 씬에서 아래로 내려 맞췄다.
 */
const CARD_H = Math.round(SCENE_H * 0.9);

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

const NIGHT_SCENES: Record<SceneKind, (p: SceneProps) => React.ReactElement> = {
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
};

const p2 = (n: number) => String(n).padStart(2, "0");

/** 기본 날씨 4종 — 씬 강제 미리보기에서 상태 문구를 씬에 맞추는 데 쓴다. */
const BASE_OF: SceneKind[] = ["맑음", "흐림", "비", "눈"];

export function WeatherWidget({ sceneOverride, nightOverride }: { sceneOverride?: SceneKind; nightOverride?: boolean }) {
  const now = useClock();
  const { coords, locLabel, weather, seasons } = useWeather();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const { w, h } = size;

  const picked = useMemo(() => pickScene(weather?.base ?? "맑음", now, seasons), [weather?.base, now, seasons]);
  const scene = sceneOverride ?? picked.scene;
  // 미리보기(씬 강제)에서는 상태 문구도 그 씬을 따라간다 — 실제 기상과 어긋나 보이지 않게.
  const base = sceneOverride && BASE_OF.includes(sceneOverride) ? (sceneOverride as BaseKind) : (weather?.base ?? "맑음");

  // 주/야 판정 — 시계가 1분 해상도라 판정도 분 단위로 갱신된다.
  const autoNight = useMemo(() => isNightAt(now, coords.lat, coords.lon), [now, coords]);
  const night = nightOverride ?? autoNight;
  // 배지 — 주간: 시즌 문구 / 야간: 기상특보성(호우·한파·열대야)만(핸드오프 정책).
  const dayBadge = sceneOverride ? (SCENE_META[sceneOverride].desc ?? null) : picked.badge;
  const nBadge = night ? nightBadge(weather) : null;

  const meta = SCENE_META[scene];
  const Scene = night ? NIGHT_SCENES[scene] : SCENES[scene];
  const bgStops = night ? meta.nightBg : meta.bg;
  // 씬 캔버스를 카드 폭에 꽉 채운다(카드 높이가 같은 비율이라 세로도 정확히 맞는다).
  const scale = w > 0 ? w / SCENE_W : 0;
  const desc = weather ? (meta.desc ? `${base} · ${meta.desc}` : base) : "-";

  // 야간 텍스트/스크림 반전(핸드오프 규칙 ③).
  const C = night
    ? { icon: "#93A0C8", loc: "#C7D0EC", clock: "#F2F5FF", temp: "#F2F5FF", desc: "#C7D0EC", hilo: "#7E89AC" }
    : { icon: "#274252", loc: "#274252", clock: "#22333C", temp: "#22333C", desc: "#22333C", hilo: "#557080" };
  const veil = night
    ? { c: "#0D1226", o: scene === "추석" ? [0.55, 0.28, 0] : [0.6, 0.32, 0] }
    : { c: "#FFFFFF", o: [0.58, 0.32, 0] };

  const onLayout = (e: LayoutChangeEvent) =>
    setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  return (
    <View
      onLayout={onLayout}
      className="overflow-hidden rounded-[20px] border border-cd-border"
      style={{ aspectRatio: SCENE_W / CARD_H, borderColor: night ? "rgba(130,148,205,0.35)" : undefined }}>
      {/* 배경 그라데이션(웹의 카드 background — 야간은 씬별 딥 네이비 3-stop) */}
      <Svg style={{ position: "absolute", left: 0, top: 0 }} width={w} height={h}>
        <Defs>
          <LinearGradient id="wxBg" x1="0" y1="0" x2="0.34" y2="1">
            {bgStops.map((s, i) => (
              <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={w} height={h} fill={night ? "#141824" : "#FFFFFF"} />
        <Rect x={0} y={0} width={w} height={h} fill="url(#wxBg)" />
      </Svg>

      {scale > 0 ? <Scene w={w} h={h} scale={scale} /> : null}

      {/* 좌측 텍스트 가독용 스크림(주간 화이트 / 야간 딥네이비 — 웹과 동일) */}
      <Svg style={{ position: "absolute", left: 0, top: 0 }} width={w} height={h} pointerEvents="none">
        <Defs>
          <LinearGradient id="wxVeil" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={veil.c} stopOpacity={veil.o[0]} />
            <Stop offset="0.36" stopColor={veil.c} stopOpacity={veil.o[1]} />
            <Stop offset="0.6" stopColor={veil.c} stopOpacity={veil.o[2]} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={w} height={h} fill="url(#wxVeil)" />
      </Svg>

      {/* 좌상 — 위치 + 배지 */}
      <View className="absolute left-[14px] top-3 flex-row items-center gap-2">
        <View className="flex-row items-center gap-1">
          <Ionicons name="location-outline" size={13} color={C.icon} />
          <Text className="text-[12px] font-semibold" style={{ color: C.loc }}>
            {locLabel ?? "위치 확인 중"}
          </Text>
        </View>
        {!night && dayBadge ? (
          <View className="rounded-full px-2 py-[3px]" style={{ backgroundColor: meta.badgeBg || "rgba(255,255,255,0.75)" }}>
            <Text className="text-[10.5px] font-semibold" style={{ color: meta.badgeFg || "#2A7A5E" }}>
              {dayBadge}
            </Text>
          </View>
        ) : null}
        {night && nBadge ? (
          <View className="rounded-full px-2 py-[3px]" style={{ backgroundColor: nBadge.bg }}>
            <Text className="text-[10.5px] font-semibold" style={{ color: nBadge.fg }}>
              {nBadge.text}
            </Text>
          </View>
        ) : null}
      </View>

      {/* 좌하 — 시계 + 기온 */}
      <View className="absolute bottom-[10px] left-[14px]">
        <Text className="text-[30px] font-extrabold" style={{ color: C.clock, lineHeight: 30, letterSpacing: -0.6 }}>
          {p2(now.getHours())}:{p2(now.getMinutes())}
        </Text>
        <View className="mt-[5px] flex-row items-baseline gap-[7px]">
          <Text className="text-[19px] font-bold" style={{ color: C.temp }}>
            {weather ? `${weather.temp.toFixed(1)}°` : "--°"}
          </Text>
          <Text className="text-[11px] font-semibold" style={{ color: C.desc }}>
            {desc}
          </Text>
          <Text className="text-[10.5px]" style={{ color: C.hilo }}>
            {weather ? `최고 ${weather.hi}° · 최저 ${weather.lo}°` : ""}
          </Text>
        </View>
      </View>
    </View>
  );
}
