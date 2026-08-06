import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/theme/useTheme";

/**
 * 지표 타일 — 홈 KPI 그리드의 한 칸(핸드오프 2a §3).
 *
 * 라벨 11 muted → 수치 22/800 → 상태 10/700. 값이 0 이면 상태는 연회색 "없음"으로,
 * 1 이상이면 항목별 강조색(`tone`)으로 쓴다. 3열 그리드에서 `flex-1` 로 나란히 놓는다.
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
  const { c } = useTheme();
  const on = value > 0;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      className="flex-1 rounded-card border border-cd-border bg-cd-card py-3 pl-[13px] pr-2 active:opacity-70">
      <Text numberOfLines={1} className="text-[11px] text-cd-muted">
        {label}
      </Text>
      <Text className="mt-[5px] text-[22px] font-extrabold leading-none text-cd-text">{value}</Text>
      <Text
        numberOfLines={1}
        className={`mt-1 text-[10px] ${on ? "font-bold" : ""}`}
        style={{ color: on ? tone : c.faint }}>
        {on ? delta : "없음"}
      </Text>
    </Pressable>
  );
}

/**
 * 액션 타일 — 빠른 실행의 스퀘클 버튼(핸드오프 2a §4, 1b 스타일).
 * 54px · radius 19 · 옅은 그림자. 아이콘 색만 기능별로 다르다.
 */
export function ActionTile({
  icon,
  label,
  tone,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tone: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} className="items-center gap-[7px] active:opacity-70">
      <View
        className="h-[54px] w-[54px] items-center justify-center rounded-[19px] border border-cd-border bg-cd-card"
        style={{
          shadowColor: "#3C4696",
          shadowOpacity: 0.12,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 6 },
          elevation: 3,
        }}>
        <Ionicons name={icon} size={23} color={tone} />
      </View>
      <Text className="text-[11px] font-semibold text-cd-body">{label}</Text>
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
