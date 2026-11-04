import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { useTheme } from "@/theme/useTheme";
import { SHADOW_CARD } from "@/theme/tokens";

/**
 * 요약 스트립(KpiStrip) — KPI 타일의 대체물(KESI Frosted 2026-11-03).
 *
 * 한 카드 안에 묶음(레이블 12/500 ink-muted 위, 숫자 24/600 tabular 아래)을 가로로 두고, 묶음 사이는 세로 hairline 만.
 * 묶음은 최대 4개, 높이 72 이내. 숫자 색은 그 숫자가 **지금 문제**(`tone` warning/danger)일 때만 바뀌고 0 이면 tone 을 주지 않는다.
 * 아이콘·색 보더·그라데이션 없음. 누를 수 있는 묶음은 전체가 터치 영역이다(화살표 없음).
 */
export interface KpiItem {
  key?: string;
  label: string;
  value: number | string;
  /** 숫자 옆 보조(단위·"내 차례"). */
  hint?: string;
  tone?: "warning" | "danger";
  onPress?: () => void;
}

export function KpiStrip({ items, flat }: { items: KpiItem[]; flat?: boolean }) {
  const { c, dark } = useTheme();
  const list = items.slice(0, 4);
  return (
    <View
      style={[{ borderColor: c.cardBorder, borderWidth: 1 }, flat ? null : dark ? SHADOW_CARD.dark : SHADOW_CARD.light]}
      className="flex-row rounded-lg bg-cd-card">
      {list.map((it, i) => {
        const problem = it.tone && Number(it.value) !== 0;
        const color = problem ? (it.tone === "danger" ? c.error : c.warning) : c.text;
        const body = (
          <>
            <Text numberOfLines={1} className="text-[12px] font-medium text-cd-muted">
              {it.label}
            </Text>
            <View className="mt-1 flex-row items-baseline gap-1">
              <Text style={{ color, fontVariant: ["tabular-nums"] }} className="text-[24px] font-semibold leading-[28px] tracking-tight">
                {it.value}
              </Text>
              {it.hint ? (
                <Text numberOfLines={1} className="shrink text-[12px] text-cd-muted">
                  {it.hint}
                </Text>
              ) : null}
            </View>
          </>
        );
        // 칸은 균등 폭 — flexBasis 0 + minWidth 0 이어야 긴 글자(힌트)가 있는 칸이 넓어지지 않는다(11-04 실기기).
        // 높이는 옛 지표 타일과 같은 76(py 14).
        const cls = `px-3 ${i > 0 ? "border-l border-cd-border" : ""}`;
        const cell = { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, paddingVertical: 14 };
        return it.onPress ? (
          <Pressable key={it.key ?? it.label} onPress={it.onPress} accessibilityRole="button" style={cell} className={`${cls} active:bg-cd-surface`}>
            {body}
          </Pressable>
        ) : (
          <View key={it.key ?? it.label} style={cell} className={cls}>
            {body}
          </View>
        );
      })}
    </View>
  );
}

/**
 * 지표 타일(호환) — 새 화면은 `KpiStrip` 을 쓴다. 남아 있는 호출처(담당자 화면 등)를 위해 Frosted 규격으로만 손봤다:
 * 카드 면 + card-border + 반경 10, 레이블 12 ink-muted → 수치 24/600 → 상태 11. 상태색은 값이 1 이상일 때만.
 */
export function StatTile({
  label,
  value,
  delta,
  tone,
  onPress,
}: {
  label: string;
  value: number;
  /** 값이 1 이상일 때 붙는 상태 문구. */
  delta: string;
  tone: string;
  onPress?: () => void;
}) {
  const { c, dark } = useTheme();
  const on = value > 0;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      style={[{ borderColor: c.cardBorder, borderWidth: 1 }, dark ? SHADOW_CARD.dark : SHADOW_CARD.light]}
      className="flex-1 rounded-lg bg-cd-card px-3 py-3 active:opacity-80">
      <Text numberOfLines={1} className="text-[12px] font-medium text-cd-muted">
        {label}
      </Text>
      <Text style={{ fontVariant: ["tabular-nums"] }} className="mt-1 text-[24px] font-semibold leading-[28px] tracking-tight text-cd-text">
        {value}
      </Text>
      <Text numberOfLines={1} className="mt-0.5 text-[11px]" style={{ color: on ? tone : c.muted }}>
        {on ? delta : "없음"}
      </Text>
    </Pressable>
  );
}

/**
 * 아이콘 상자(IconWell) — 빠른 실행·전체 메뉴 타일의 아이콘 바탕. 아주 옅은 세로 그라데이션(흰 → surface-sunken) +
 * 옅은 테두리 + 1px 그림자로 **살짝 입체적인 버튼**처럼 보인다(2026-11-04 사용자 요청). 반경 10.
 */
export function IconWell({ size, children }: { size: number; children: React.ReactNode }) {
  const { c, dark } = useTheme();
  const id = `well-${size}-${dark ? "d" : "l"}`;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: dark ? c.border : "#e4e6ec",
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: c.surface,
        shadowColor: "#1d2435",
        shadowOpacity: dark ? 0 : 0.06,
        shadowRadius: 2,
        shadowOffset: { width: 0, height: 1 },
        elevation: 1,
      }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={dark ? "#2b2e38" : "#ffffff"} />
            <Stop offset="1" stopColor={dark ? "#1f2229" : "#eaecf2"} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={size} height={size} fill={`url(#${id})`} />
      </Svg>
      {children}
    </View>
  );
}

/**
 * 액션 타일 — 빠른 실행의 아이콘 버튼. 48px IconWell(옅은 그라데이션 입체 상자) + **기능별 색 아이콘**(`tone`, 2026-11-04 사용자 결정으로 복원),
 * 아래 라벨 12/500.
 */
export function ActionTile({
  icon,
  label,
  tone,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tone?: string;
  onPress: () => void;
}) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} className="items-center gap-1.5 active:opacity-70">
      <IconWell size={48}>
        <Ionicons name={icon} size={22} color={tone ?? c.primary} />
      </IconWell>
      <Text className="text-[12px] font-medium text-cd-text">{label}</Text>
    </Pressable>
  );
}

/** 타일 그리드 — N개씩 끊어 행으로 배치하고 빈 칸을 채운다(마지막 행이 넓어지지 않게). */
export function TileGrid({ columns = 3, children }: { columns?: number; children: React.ReactNode[] }) {
  const items = children.filter(Boolean);
  const rows: React.ReactNode[][] = [];
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
  return (
    <View className="gap-2">
      {rows.map((row, i) => (
        <View key={i} className="flex-row gap-2">
          {row}
          {row.length < columns
            ? Array.from({ length: columns - row.length }, (_, j) => <View key={`f${j}`} className="flex-1" />)
            : null}
        </View>
      ))}
    </View>
  );
}
