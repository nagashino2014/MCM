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
import { Pressable, ScrollView, Text, View, type LayoutChangeEvent } from "react-native";
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
import { HourIcon, type SceneProps } from "./parts";
import {
  SCENE_H,
  SCENE_META,
  SCENE_W,
  isNightAt,
  nightBadge,
  pickScene,
  type BaseKind,
  type SceneKind,
  type WeatherHour,
} from "./rules";
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

/**
 * 시간대별 예보 패널 — 위젯 전체를 덮되 배경은 반투명이라 **씬이 옅게 비친다**(웹과 같은 규칙).
 * 시계열은 글라스 카드 하나에 담아 아래쪽에 두고, 가로 스크롤로 약 2일 반까지 훑는다.
 * 칸의 주/야 아이콘은 그 시각의 일출·일몰로 판정한다.
 */
function HoursPanel({
  hours,
  night,
  coords,
  locLabel,
  onClose,
}: {
  hours: WeatherHour[];
  night: boolean;
  coords: { lat: number; lon: number };
  locLabel: string | null;
  onClose: () => void;
}) {
  const ink = night ? "#F2F5FF" : "#22333C";
  const sub = night ? "#A9B3D2" : "#557080";
  const faint = night ? "#7E89AC" : "#8496A0";
  const rainInk = night ? "#8CAAF0" : "#3D7AD0";
  const line = night ? "rgba(130,148,205,0.3)" : "rgba(120,135,180,0.22)";
  const dayInk = night ? "#A9B8FF" : "#4A63D8";
  const cardBg = night ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.55)";
  const cardBd = night ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.85)";

  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        backgroundColor: night ? "rgba(13,18,38,0.8)" : "rgba(255,255,255,0.82)",
      }}>
      <View className="flex-row items-center gap-1.5 px-[14px] pb-1 pt-3">
        <Ionicons name="location-outline" size={13} color={night ? "#93A0C8" : "#274252"} />
        <Text className="text-[12px] font-semibold" style={{ color: night ? "#C7D0EC" : "#274252" }}>
          {locLabel ?? "시간대별 예보"}
        </Text>
        <Text className="text-[10.5px]" style={{ color: faint }}>
          시간대별
        </Text>
        <Pressable
          onPress={onClose}
          className="ml-auto flex-row items-center gap-1 rounded-lg px-2.5 py-1 active:opacity-70"
          style={{
            backgroundColor: night ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.9)",
            borderWidth: 1,
            borderColor: cardBd,
          }}>
          <Ionicons name="chevron-back" size={11} color={ink} />
          <Text className="text-[11px] font-bold" style={{ color: ink }}>
            돌아가기
          </Text>
        </Pressable>
      </View>

      {hours.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-[11.5px] font-semibold" style={{ color: sub }}>
            시간대별 예보를 불러오는 중입니다
          </Text>
        </View>
      ) : (
        <View className="flex-1 justify-end px-[12px] pb-[12px]">
          <View
            className="overflow-hidden"
            style={{ borderRadius: 12, backgroundColor: cardBg, borderWidth: 1, borderColor: cardBd }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 2, paddingVertical: 9 }}>
              {hours.map((h, i) => {
                const at = new Date(`${h.t}:00+09:00`);
                const newDay = i === 0 || h.t.slice(0, 10) !== hours[i - 1].t.slice(0, 10);
                const label = newDay ? `${at.getMonth() + 1}/${at.getDate()}` : `${at.getHours()}시`;
                return (
                  <View
                    key={h.t}
                    className="items-center gap-1"
                    style={{
                      width: 50,
                      // 날짜가 바뀌는 칸 앞 얇은 구분선 — 카드 하나 안에서 '내일/모레'를 나눈다.
                      borderLeftWidth: newDay && i > 0 ? 1 : 0,
                      borderLeftColor: line,
                    }}>
                    <Text
                      style={{ fontSize: 11, fontWeight: newDay ? "800" : "600", color: newDay ? dayInk : sub }}>
                      {label}
                    </Text>
                    <HourIcon kind={h.base} night={isNightAt(at, coords.lat, coords.lon)} size={24} />
                    <Text style={{ fontSize: 13.5, fontWeight: "800", color: ink }}>{h.temp}°</Text>
                    <Text style={{ fontSize: 10.5, fontWeight: "700", color: rainInk, minHeight: 13 }}>
                      {h.pop > 0 ? `${h.pop}%` : ""}
                    </Text>
                    <Text style={{ fontSize: 10, color: faint, minHeight: 12 }}>
                      {h.pcp > 0 ? `${h.pcp}mm` : ""}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      )}
    </View>
  );
}

/** 기본 날씨 4종 — 씬 강제 미리보기에서 상태 문구를 씬에 맞추는 데 쓴다. */
const BASE_OF: SceneKind[] = ["맑음", "흐림", "비", "눈"];

export function WeatherWidget({ sceneOverride, nightOverride }: { sceneOverride?: SceneKind; nightOverride?: boolean }) {
  const now = useClock();
  const { coords, locLabel, weather, seasons, relocate, locating } = useWeather();
  const [size, setSize] = useState({ w: 0, h: 0 });
  /** 시간대별 예보 패널 — 하단 절반을 누르면 열리고 우상단 '돌아가기'로 닫는다. */
  const [panel, setPanel] = useState(false);
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

      {/* 좌상 — 위치 + 배지. 패널이 열리면 숨긴다(패널 헤더에 위치명이 다시 나온다). */}
      <View
        className="absolute left-[14px] top-3 flex-row items-center gap-2"
        style={{ opacity: panel ? 0 : 1 }}
        pointerEvents={panel ? "none" : "auto"}>
        {/* 위치 칩 — 누르면 현재 위치를 다시 측정한다(마지막 좌표 캐시 무시). */}
        <Pressable
          onPress={relocate}
          disabled={locating}
          hitSlop={8}
          className="flex-row items-center gap-1 active:opacity-60">
          <Ionicons name="location-outline" size={13} color={C.icon} />
          <Text className="text-[12px] font-semibold" style={{ color: C.loc }}>
            {locating ? "위치 확인 중…" : (locLabel ?? "위치 확인 중")}
          </Text>
        </Pressable>
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

      {/* 좌하 — 시계 + 기온. 패널이 열리면 숨긴다(반투명 배경 너머로 겹쳐 비치면 읽기 어렵다). */}
      <View className="absolute bottom-[10px] left-[14px]" style={{ opacity: panel ? 0 : 1 }}>
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

      {/* 하단 절반 — 터치하면 시간대별 예보가 펼쳐진다(사용자 지정 조작). */}
      {!panel ? (
        <Pressable
          onPress={() => setPanel(true)}
          accessibilityLabel="시간대별 예보 보기"
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "50%" }}
        />
      ) : null}
      {panel ? (
        <HoursPanel
          hours={weather?.hours ?? []}
          night={night}
          coords={coords}
          locLabel={locLabel}
          onClose={() => setPanel(false)}
        />
      ) : null}
    </View>
  );
}
