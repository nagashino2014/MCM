import { type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from "react-native";

import { ThemeVarsScope } from "@/theme/ThemeProvider";
import { useTheme } from "@/theme/useTheme";

import { IconButton } from "./Button";

/**
 * 바텀 시트 — RN Modal 기반(의존성 0). 확인·선택·짧은 입력에 쓴다.
 * 스크림 탭으로 닫히며, 키보드가 올라오면 시트가 밀려 올라간다.
 */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { c } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Modal 은 별도 뷰 계층이라 루트의 토큰 주입이 닿지 않을 수 있다 → 여기서 다시 주입. */}
      <ThemeVarsScope>
        {/* 딤은 뒤 화면이 겹쳐 보이지 않게 진하게(사용자 피드백 2026-08-09 — 40% 는 뒤 메뉴가 비쳐 불편). */}
        <View className="flex-1 justify-end bg-black/70">
          <Pressable className="flex-1" onPress={onClose} />
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            {/* 본체 배경은 hex 로 명시 — 토큰 변수 미해석 상황에서도 반투명해지지 않게 방어. */}
            <View
              className="max-h-[85%] rounded-t-3xl border-t border-cd-border pb-6"
              style={{ backgroundColor: c.card }}>
              <View className="flex-row items-center gap-2 border-b border-cd-border px-4 py-2.5">
                <Text className="flex-1 text-[16px] font-extrabold text-cd-text">
                  {title ?? ""}
                </Text>
                <IconButton icon="close" onPress={onClose} />
              </View>
              {/* ⚠ shrink 필수 — RN flexShrink 기본 0 이라, 내용이 max-h 를 넘으면 줄어들지 않고
                  시트 밖으로 그려져 하단이 잘린다(휴가 종류 목록 실측 2026-08-10). shrink 를 주면
                  내부 ScrollView 가 남은 높이 안에서 스크롤한다. */}
              {/* overflow-hidden — 내용이 max-h 를 넘어도 footer 와 겹치지 않게 잘라낸다(넘치는 시트는
                  자체 ScrollView 로 감싼다 — 영업 일정 등록 겹침 실측 2026-08-20). */}
              <View className="shrink overflow-hidden px-4 py-4">{children}</View>
              {footer ? (
                <View className="flex-row gap-2 border-t border-cd-border px-4 pt-3">{footer}</View>
              ) : null}
            </View>
          </KeyboardAvoidingView>
        </View>
      </ThemeVarsScope>
    </Modal>
  );
}
