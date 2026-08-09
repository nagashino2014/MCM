import { useId } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { CTA_FROM, CTA_TO } from '@/components/ui/GradientButton';

/**
 * 근태·휴가 화면의 인포그래픽 — 핸드오프 3a 수치.
 *
 * 차트 라이브러리를 새로 넣지 않고 이미 쓰는 react-native-svg 로 그린다(날씨 씬에서 도입).
 * 색은 cd 토큰이 아니라 **핸드오프 고정색**이다 — 차트 의미색(정상/초과)은 테마와 무관하게
 * 같은 뜻이어야 하고, 데스크탑·모바일이 같은 값을 쓴다.
 */

export const CHART = {
  /** 일별 근무 — 정상일 */
  normal: '#c7cdf4',
  /** 일별 근무 — 초과 발생일(위→아래 그라데이션) */
  overFrom: '#f0a72c',
  overTo: '#f4c064',
  /** 초과근무 게이지 — 한도 전/후 */
  gaugeUnder: '#f0a72c',
  gaugeOver: '#e2574c',
  track: '#f3f4fa',
  ringTrack: '#eef0f9',
  /** 요일 라벨 */
  sun: '#d98d84',
  sat: '#8a9bd6',
  weekday: '#878ea8',
  muted: '#a6acc4',
  ink: '#1b2144',
} as const;

/** 도넛 링 — 잔여 연차. 진행색은 CTA 그라데이션과 같다(핸드오프). */
export function DonutGauge({
  value,
  total,
  size = 96,
  thickness = 9,
  label,
  caption = '잔여',
}: {
  value: number;
  total: number;
  size?: number;
  thickness?: number;
  label?: string;
  caption?: string;
}) {
  const gid = `ring-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  const ratio = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;

  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={CTA_FROM} />
            <Stop offset="1" stopColor={CTA_TO} />
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={CHART.ringTrack} strokeWidth={thickness} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={`url(#${gid})`}
          strokeWidth={thickness}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circ * ratio} ${circ}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text className="text-[18px] font-extrabold leading-none" style={{ color: CHART.ink }}>
        {label ?? value}
      </Text>
      <Text className="mt-0.5 text-[10px]" style={{ color: CHART.weekday }}>
        {caption}
      </Text>
    </View>
  );
}

/**
 * 초과근무 게이지 — 한도 지점에 흰 마커가 있는 앰버→코랄 게이지.
 * 값이 한도를 넘으면 게이지 전체를 값 기준으로 그리고 한도 위치를 마커로 보여준다(핸드오프).
 */
export function OvertimeGauge({ value, limit, height = 8 }: { value: number; limit: number; height?: number }) {
  const gid = `og-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const over = value > limit;
  // 한도를 넘으면 막대 전체가 '값', 마커는 한도 지점. 아니면 막대는 한도 기준 비율만큼 채운다.
  const fill = over ? 1 : limit > 0 ? Math.max(0, Math.min(1, value / limit)) : 0;
  const markerAt = over && value > 0 ? limit / value : null;

  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: CHART.track, overflow: 'hidden' }}>
      <View style={{ width: `${fill * 100}%`, height }}>
        <Svg width="100%" height={height}>
          <Defs>
            {/* 한도를 넘긴 구간만 코랄로 — 색이 한도 지점에서 딱 갈리도록 같은 offset 을 두 번 준다. */}
            <LinearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
              {markerAt != null
                ? [
                    <Stop key="a" offset="0" stopColor={CHART.gaugeUnder} />,
                    <Stop key="b" offset={markerAt} stopColor={CHART.gaugeUnder} />,
                    <Stop key="c" offset={Math.min(1, markerAt + 0.01)} stopColor={CHART.gaugeOver} />,
                    <Stop key="d" offset="1" stopColor={CHART.gaugeOver} />,
                  ]
                : [
                    <Stop key="a" offset="0" stopColor={CHART.gaugeUnder} />,
                    <Stop key="b" offset="1" stopColor={CHART.gaugeUnder} />,
                  ]}
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width="100%" height={height} rx={height / 2} fill={`url(#${gid})`} />
        </Svg>
      </View>
      {markerAt != null ? (
        <View
          style={{
            position: 'absolute',
            left: `${markerAt * 100}%`,
            top: -1,
            bottom: -1,
            width: 2,
            backgroundColor: '#FFFFFF',
          }}
        />
      ) : null}
    </View>
  );
}

/** 일별 근무 막대 — 정상일은 단색, 초과 발생일은 앰버 그라데이션. */
export function DayBars({
  days,
  max,
  height = 64,
}: {
  days: { label: string; minutes: number | null; over?: boolean; dow: number }[];
  /** 막대 100% 기준(분). 보통 소정근로 8h. */
  max: number;
  height?: number;
}) {
  const gid = `db-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View className="gap-1.5">
      <View className="flex-row items-end gap-[9px]" style={{ height }}>
        {days.map((d, i) => {
          const m = d.minutes ?? 0;
          const ratio = max > 0 ? Math.max(0, Math.min(1, m / (max * 1.35))) : 0;
          const h = m > 0 ? Math.max(10, ratio * height) : 3;
          return (
            <View key={i} className="flex-1 justify-end" style={{ height }}>
              <Svg width="100%" height={h}>
                <Defs>
                  <LinearGradient id={`${gid}-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={CHART.overFrom} />
                    <Stop offset="1" stopColor={CHART.overTo} />
                  </LinearGradient>
                </Defs>
                <Rect
                  x={0}
                  y={0}
                  width="100%"
                  height={h}
                  rx={5}
                  fill={m === 0 ? CHART.track : d.over ? `url(#${gid}-${i})` : CHART.normal}
                />
              </Svg>
            </View>
          );
        })}
      </View>
      <View className="flex-row gap-[9px]">
        {days.map((d, i) => (
          <Text
            key={i}
            className="flex-1 text-center text-[10px]"
            style={{ color: d.dow === 0 ? CHART.sun : d.dow === 6 ? CHART.sat : CHART.weekday }}>
            {d.label}
          </Text>
        ))}
      </View>
      <View className="flex-row gap-3 pt-0.5">
        <Legend color={CHART.normal} label="정상" />
        <Legend color={CHART.overFrom} label="초과 발생" />
      </View>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <View style={{ width: 8, height: 8, borderRadius: 3, backgroundColor: color }} />
      <Text className="text-[10px]" style={{ color: CHART.muted }}>
        {label}
      </Text>
    </View>
  );
}
