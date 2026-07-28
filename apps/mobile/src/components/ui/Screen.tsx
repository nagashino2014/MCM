import { type ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { useTheme } from "@/theme/useTheme";

/**
 * 모든 화면의 공통 껍데기 — 배경·안전영역·스크롤·당겨서 새로고침(+옵션 자체 헤더).
 *
 * 헤더 규칙(★ 어기면 iOS 에서 헤더 점멸 버그가 재발한다):
 * - 탭/스택 화면의 헤더는 **네비게이터 레이아웃(`_layout.tsx`)에서 정적으로** 정의한다.
 * - 화면 파일 안에서 `<Stack.Screen options={{...}} />` 를 렌더하지 않는다.
 *   과거 명함 화면에서 인라인 options 가 헤더 갱신 루프를 만들어 터치까지 막혔다(실측).
 * - 네비게이터 헤더를 끈 화면(모달성)만 이 컴포넌트의 `title` 로 자체 헤더를 그린다.
 */
export interface ScreenProps {
  title?: string;
  subtitle?: string;
  /** 뒤로가기 버튼 표시(스택 화면). 탭 최상위 화면은 false. */
  back?: boolean;
  /** 헤더 우측 슬롯(아이콘 버튼 등). */
  right?: ReactNode;
  children: ReactNode;
  /** 본문을 ScrollView 로 감쌀지. 자체 FlatList 를 쓰는 화면은 false. */
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** 본문 좌우 여백(기본 적용). */
  padded?: boolean;
}

export function Screen({
  title,
  subtitle,
  back,
  right,
  children,
  scroll = true,
  refreshing,
  onRefresh,
  padded = true,
}: ScreenProps) {
  const { c } = useTheme();
  const router = useRouter();

  const body = padded ? <View className="gap-3 p-4">{children}</View> : children;

  return (
    // 네비게이터 헤더가 있는 화면은 상단 안전영역을 헤더가 이미 처리한다(이중 여백 방지).
    // style 의 배경색은 보험 — 토큰(CSS 변수) 해석이 어긋나도 화면이 투명해지지 않게 한다.
    <SafeAreaView
      edges={title ? ["top"] : []}
      style={{ backgroundColor: c.bg }}
      className="flex-1 bg-cd-bg">
      {title ? (
        <View className="flex-row items-center gap-2 border-b border-cd-border bg-cd-card px-2 py-2.5">
          {back ? (
            <Pressable
              onPress={() => router.back()}
              hitSlop={10}
              className="h-11 w-11 items-center justify-center rounded-full active:opacity-60">
              <Ionicons name="chevron-back" size={24} color={c.text} />
            </Pressable>
          ) : (
            <View className="w-2" />
          )}
          <View className="flex-1">
            <Text numberOfLines={1} className="text-[17px] font-extrabold text-cd-text">
              {title}
            </Text>
            {subtitle ? (
              <Text numberOfLines={1} className="text-[12px] text-cd-faint">
                {subtitle}
              </Text>
            ) : null}
          </View>
          {right}
        </View>
      ) : null}

      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={!!refreshing}
                onRefresh={onRefresh}
                tintColor={c.faint}
              />
            ) : undefined
          }>
          {body}
        </ScrollView>
      ) : (
        <View className="flex-1">{body}</View>
      )}
    </SafeAreaView>
  );
}
