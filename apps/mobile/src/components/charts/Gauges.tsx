import { Text, View } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';

import { useTheme } from '@/theme/useTheme';

/**
 * 근태·휴가 화면의 인포그래픽 부품 — 차트 라이브러리를 새로 넣지 않고
 * 이미 쓰는 react-native-svg 로 그린다(날씨 씬에서 도입한 것).
 */

/** 도넛 게이지 — 잔여 연차처럼 "전체 중 얼마"를 한눈에 보여준다. */
export function DonutGauge({
  value,
  total,
  size = 120,
  thickness = 12,
  color,
  label,
  caption,
}: {
  value: number;
  total: number;
  size?: number;
  thickness?: number;
  color?: string;
  /** 가운데 큰 글자(기본은 value). */
  label?: string;
  /** 가운데 작은 글자. */
  caption?: string;
}) {
  const { c } = useTheme();
  const tone = color ?? c.primary;
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  const ratio = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;

  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.surface} strokeWidth={thickness} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={tone}
          strokeWidth={thickness}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circ * ratio} ${circ}`}
          // 12시 방향에서 시작하도록 회전
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text className="text-[24px] font-extrabold text-cd-text">{label ?? value}</Text>
      {caption ? <Text className="mt-0.5 text-[11px] text-cd-faint">{caption}</Text> : null}
    </View>
  );
}

/** 가로 막대 게이지 — 한도 대비 사용량(주 초과근무). 한도를 넘으면 경고색. */
export function BarGauge({
  value,
  limit,
  height = 10,
  color,
  overColor,
}: {
  value: number;
  limit: number;
  height?: number;
  color?: string;
  overColor?: string;
}) {
  const { c } = useTheme();
  const over = limit > 0 && value > limit;
  const tone = over ? (overColor ?? c.error) : (color ?? c.primary);
  const ratio = limit > 0 ? Math.max(0, Math.min(1, value / limit)) : 0;
  return (
    <View style={{ height, backgroundColor: c.surface, borderRadius: height / 2, overflow: 'hidden' }}>
      <View style={{ width: `${ratio * 100}%`, height, backgroundColor: tone, borderRadius: height / 2 }} />
    </View>
  );
}

/** 요일별 미니 막대 — 이번 주 일별 근무시간. 값이 없는 날(휴무·미기록)은 빈 칸. */
export function DayBars({
  days,
  max,
  height = 44,
}: {
  days: { label: string; minutes: number | null; leave?: boolean; today?: boolean }[];
  /** 막대 100% 기준(분). 보통 소정근로 8h. */
  max: number;
  height?: number;
}) {
  const { c } = useTheme();
  return (
    <View className="flex-row items-end gap-1.5">
      {days.map((d, i) => {
        const m = d.minutes ?? 0;
        const ratio = max > 0 ? Math.max(0, Math.min(1.35, m / max)) : 0;
        const h = Math.max(m > 0 ? 4 : 2, ratio * height);
        const over = m > max;
        return (
          <View key={i} className="flex-1 items-center gap-1">
            <View style={{ height, justifyContent: 'flex-end', width: '100%' }}>
              <Svg width="100%" height={h}>
                <Rect
                  x={0}
                  y={0}
                  width="100%"
                  height={h}
                  rx={3}
                  fill={d.leave ? c.successSoft : over ? c.warning : m > 0 ? c.primary : c.surface}
                />
              </Svg>
            </View>
            <Text
              className={`text-[10px] ${d.today ? 'font-extrabold' : ''}`}
              style={{ color: d.today ? c.primary : c.faint }}>
              {d.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
