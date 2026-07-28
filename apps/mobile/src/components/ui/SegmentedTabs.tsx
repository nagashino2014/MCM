import { ScrollView, Text, View } from "react-native";

import { Chip, Count } from "./Chip";

export interface SegmentItem<T extends string> {
  key: T;
  label: string;
  count?: number | null;
}

/**
 * 가로 스크롤 세그먼트 탭(결재함 대기/예정/내 기안, 소통 게시판/주소록 등).
 * 항목이 늘어나도 잘리지 않게 스크롤로 흘린다(축소 금지 원칙).
 */
export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: SegmentItem<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
      {items.map((it) => (
        <View key={it.key} className="flex-row items-center">
          <Chip label={it.label} active={value === it.key} onPress={() => onChange(it.key)} />
          {it.count ? (
            <View className="-ml-1.5">
              <Count value={it.count} />
            </View>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

/** 섹션 제목(목록 그룹 헤더). */
export function SectionTitle({ children }: { children: string }) {
  return (
    <Text className="px-4 pb-1 pt-4 text-[12px] font-bold uppercase tracking-wide text-cd-faint">
      {children}
    </Text>
  );
}
