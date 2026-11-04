import { type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "@/theme/useTheme";
import { ShellBackground } from "@/theme/ShellBackground";
import { AppHeader } from "./AppHeader";
import { PullRefresh } from "./PullRefresh";
import { TAB_BAR_INSET } from "./GlassTabBar";

/**
 * 모든 화면의 공통 껍데기 — 바탕(canvas)·안전영역·스크롤·당겨서 새로고침(+옵션 자체 헤더).
 *
 * 헤더 규칙(★ 어기면 iOS 에서 헤더 점멸 버그가 재발한다):
 * - 탭/스택 화면의 헤더는 **네비게이터 레이아웃(`_layout.tsx`)에서 정적으로** 정의한다.
 * - 화면 파일 안에서 `<Stack.Screen options={{...}} />` 를 렌더하지 않는다.
 *   과거 명함 화면에서 인라인 options 가 헤더 갱신 루프를 만들어 터치까지 막혔다(실측).
 * - 네비게이터 헤더를 끈 화면(모달성)만 이 컴포넌트의 `title` 로 자체 헤더를 그린다.
 *
 * 자체 헤더는 공용 AppHeader(홈·전체 메뉴를 뺀 모든 화면이 같은 모양, 2026-11-04).
 */
export interface ScreenProps {
  title?: string;
  subtitle?: string;
  /** 뒤로가기 버튼 표시(스택 화면). 탭 최상위 화면은 false. */
  back?: boolean;
  /** 뒤로가기 대체 동작(예: 미저장 확인). 없으면 router.back(). */
  onBack?: () => void;
  /** 헤더 우측 슬롯(아이콘 버튼 등). */
  right?: ReactNode;
  children: ReactNode;
  /** 본문을 ScrollView 로 감쌀지. 자체 FlatList 를 쓰는 화면은 false. */
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** 본문 좌우 여백(기본 적용). */
  padded?: boolean;
  /** 하단 탭 화면 — 글라스 플로팅 탭 바 뒤로 콘텐츠가 이어지도록 스크롤 하단 여백을 TAB_BAR_INSET 만큼 더한다. */
  inTab?: boolean;
}

export function Screen({
  title,
  subtitle,
  back,
  onBack,
  right,
  children,
  scroll = true,
  refreshing,
  onRefresh,
  padded = true,
  inTab,
}: ScreenProps) {
  const { c } = useTheme();

  // 카드 사이 16(모바일 폭에서의 space-5 대응), 바깥 여백 16.
  const body = padded ? <View className="gap-4 p-4">{children}</View> : children;

  return (
    // 네비게이터 헤더가 있는 화면은 상단 안전영역을 헤더가 이미 처리한다(이중 여백 방지).
    // 바탕은 **투명** — 셸 그라데이션(ThemeProvider 의 ShellBackground)이 비친다(2026-11-04).
    // 자체 헤더가 있으면 안전영역은 헤더가 흰색으로 채운다(edges 없음 + safe="pad"); 없으면 네비게이터 헤더가 처리한다.
    <SafeAreaView edges={[]} className="flex-1 bg-transparent">
      {/* 셸 바탕은 화면 안에서 그린다 — 네이티브 스택 화면이 루트의 배경을 가린다(11-04 실기기). */}
      <ShellBackground />
      {title ? <AppHeader safe="pad" title={title} subtitle={subtitle} back={back} onBack={onBack} right={right} /> : null}

      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: inTab ? 32 + TAB_BAR_INSET : 32 }}
          keyboardShouldPersistTaps="handled"
          // 2026-10-20: iOS 키보드가 입력란을 가리지 않도록 — 키보드 높이만큼 인셋 + 포커스된 입력란을 키보드 위로 스크롤(RN 0.86)
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="interactive"
          refreshControl={
            onRefresh ? (
              <PullRefresh
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
