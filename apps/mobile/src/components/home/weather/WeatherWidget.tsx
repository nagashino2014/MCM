/**
 * 홈 날씨/시계 위젯 — 데스크탑 위젯의 모바일 이식(핸드오프 2a §2).
 *
 * 카드는 씬 캔버스와 같은 400:286 비율이고, 씬은 카드 폭에 꽉 차게 스케일한다. 씬 위에 얹는 텍스트는
 * 테마 토큰이 아니라 **고정색**이다 — 배경(씬)이 항상 밝은 일러스트라 다크모드에서도 같다.
 */
import { useMemo, useState } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { CloudyScene, RainScene, SnowScene, SunnyScene } from "./scenes-basic";
import { ChuseokScene, SeolScene, XmasScene } from "./scenes-holiday";
import { AutumnScene, SpringScene, SummerScene } from "./scenes-season";
import { type SceneProps } from "./parts";
import { SCENE_H, SCENE_META, SCENE_W, pickScene, type BaseKind, type SceneKind } from "./rules";
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

const p2 = (n: number) => String(n).padStart(2, "0");

/** 기본 날씨 4종 — 씬 강제 미리보기에서 상태 문구를 씬에 맞추는 데 쓴다. */
const BASE_OF: SceneKind[] = ["맑음", "흐림", "비", "눈"];

export function WeatherWidget({ sceneOverride }: { sceneOverride?: SceneKind }) {
  const now = useClock();
  const { locLabel, weather, seasons } = useWeather();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const { w, h } = size;

  const picked = useMemo(() => pickScene(weather?.base ?? "맑음", now, seasons), [weather?.base, now, seasons]);
  const scene = sceneOverride ?? picked.scene;
  const badge = sceneOverride ? (SCENE_META[sceneOverride].desc ?? null) : picked.badge;
  // 미리보기(씬 강제)에서는 상태 문구도 그 씬을 따라간다 — 실제 기상과 어긋나 보이지 않게.
  const base = sceneOverride && BASE_OF.includes(sceneOverride) ? (sceneOverride as BaseKind) : (weather?.base ?? "맑음");

  const meta = SCENE_META[scene];
  const Scene = SCENES[scene];
  // 씬 캔버스를 카드 폭에 꽉 채운다(카드 높이가 같은 비율이라 세로도 정확히 맞는다).
  const scale = w > 0 ? w / SCENE_W : 0;
  const desc = weather ? (meta.desc ? `${base} · ${meta.desc}` : base) : "-";

  const onLayout = (e: LayoutChangeEvent) =>
    setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  return (
    <View
      onLayout={onLayout}
      className="overflow-hidden rounded-[20px] border border-cd-border"
      style={{ aspectRatio: SCENE_W / CARD_H }}>
      {/* 배경 그라데이션(웹의 카드 background) */}
      <Svg style={{ position: "absolute", left: 0, top: 0 }} width={w} height={h}>
        <Defs>
          <LinearGradient id="wxBg" x1="0" y1="0" x2="0.34" y2="1">
            {meta.bg.map((s, i) => (
              <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={w} height={h} fill="#FFFFFF" />
        <Rect x={0} y={0} width={w} height={h} fill="url(#wxBg)" />
      </Svg>

      {scale > 0 ? <Scene w={w} h={h} scale={scale} /> : null}

      {/* 좌측 텍스트 가독용 화이트 베일(웹과 동일) */}
      <Svg style={{ position: "absolute", left: 0, top: 0 }} width={w} height={h} pointerEvents="none">
        <Defs>
          <LinearGradient id="wxVeil" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.58} />
            <Stop offset="0.36" stopColor="#FFFFFF" stopOpacity={0.32} />
            <Stop offset="0.6" stopColor="#FFFFFF" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={w} height={h} fill="url(#wxVeil)" />
      </Svg>

      {/* 좌상 — 위치 + 시즌 배지 */}
      <View className="absolute left-[14px] top-3 flex-row items-center gap-2">
        <View className="flex-row items-center gap-1">
          <Ionicons name="location-outline" size={13} color="#274252" />
          <Text className="text-[12px] font-semibold" style={{ color: "#274252" }}>
            {locLabel ?? "위치 확인 중"}
          </Text>
        </View>
        {badge ? (
          <View className="rounded-full px-2 py-[3px]" style={{ backgroundColor: meta.badgeBg || "rgba(255,255,255,0.75)" }}>
            <Text className="text-[10.5px] font-semibold" style={{ color: meta.badgeFg || "#2A7A5E" }}>
              {badge}
            </Text>
          </View>
        ) : null}
      </View>

      {/* 좌하 — 시계 + 기온 */}
      <View className="absolute bottom-[10px] left-[14px]">
        <Text className="text-[30px] font-extrabold" style={{ color: "#22333C", lineHeight: 30, letterSpacing: -0.6 }}>
          {p2(now.getHours())}:{p2(now.getMinutes())}
        </Text>
        <View className="mt-[5px] flex-row items-baseline gap-[7px]">
          <Text className="text-[19px] font-bold" style={{ color: "#22333C" }}>
            {weather ? `${weather.temp.toFixed(1)}°` : "--°"}
          </Text>
          <Text className="text-[11px] font-semibold" style={{ color: "#22333C" }}>
            {desc}
          </Text>
          <Text className="text-[10.5px]" style={{ color: "#557080" }}>
            {weather ? `최고 ${weather.hi}° · 최저 ${weather.lo}°` : ""}
          </Text>
        </View>
      </View>
    </View>
  );
}
