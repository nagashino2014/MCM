import { Pressable, ScrollView, Text, View } from "react-native";

import { useTheme } from "@/theme/useTheme";
import { SHADOW_CARD } from "@/theme/tokens";

export interface SegmentItem<T extends string> {
  key: T;
  label: string;
  count?: number | null;
}

/**
 * 세그먼트형 페이지 탭(Tabs segment) — 화면의 **내용을 통째로 바꾸는** 탭(결재함 대기/예정/내 기안, 소통 게시판/주소록).
 *
 * 묶음 = 카드 면 + card-border + 반경 10 + 1단 그림자, 안쪽 패딩 4·탭 사이 2. 탭 = 높이 32, 패딩 6/14, 반경 7,
 * 글자 13/500. 선택 = tab-selected(남색 틴트) 바탕 + tab-selected-ink 글자, 테두리·밑줄 없음. 비선택 = ink-muted.
 * 묶음은 내용 폭이고 한 줄을 유지한다(넘치면 가로 스크롤, 축소 금지). 건수는 탭 안 12 글자.
 */
export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  flat,
}: {
  items: SegmentItem<T>[];
  value: T;
  onChange: (v: T) => void;
  /** 카드·시트 안에 놓이면 그림자를 뺀다. */
  flat?: boolean;
}) {
  const { c, dark } = useTheme();
  return (
    // ⚠ flexGrow:0 필수 — 세로 flex 컨테이너(Screen scroll={false}) 안에서 가로 ScrollView 가
    // 남은 세로 공간을 전부 차지해, 결재함 탭·목록이 화면 중앙으로 밀려 내려가던 버그가 있었다.
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, flexShrink: 0 }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8 }}>
      <View
        accessibilityRole="tablist"
        style={[{ borderColor: c.cardBorder, borderWidth: 1 }, flat ? null : dark ? SHADOW_CARD.dark : SHADOW_CARD.light]}
        className="flex-row gap-0.5 rounded-lg bg-cd-card p-1">
        {items.map((it) => {
          const on = value === it.key;
          return (
            <Pressable
              key={it.key}
              onPress={() => onChange(it.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              style={{ height: 32, backgroundColor: on ? c.tabSelected : "transparent" }}
              className="flex-row items-center gap-1.5 rounded-md px-3.5 active:opacity-80">
              <Text style={{ color: on ? c.tabSelectedInk : c.muted }} className="text-[13px] font-medium">
                {it.label}
              </Text>
              {it.count ? (
                <Text style={{ color: on ? c.tabSelectedInk : c.muted, fontVariant: ["tabular-nums"] }} className="text-[12px]">
                  {it.count > 99 ? "99+" : it.count}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

/** 섹션 제목(목록 그룹 헤더) — 12/500 ink-muted. 대문자 변환·넓은 자간 없음. 앞 그룹과는 위 여백으로 뗀다. */
export function SectionTitle({ children }: { children: string }) {
  return <Text className="px-4 pb-2 pt-6 text-[12px] font-medium text-cd-muted">{children}</Text>;
}
