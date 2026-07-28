import { type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from "react-native";

import { ThemeVarsScope } from "@/theme/ThemeProvider";

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
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Modal 은 별도 뷰 계층이라 루트의 토큰 주입이 닿지 않을 수 있다 → 여기서 다시 주입. */}
      <ThemeVarsScope>
        <View className="flex-1 justify-end bg-black/40">
          <Pressable className="flex-1" onPress={onClose} />
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View className="max-h-[85%] rounded-t-3xl border-t border-cd-border bg-cd-card pb-6">
              <View className="flex-row items-center gap-2 border-b border-cd-border px-4 py-2.5">
                <Text className="flex-1 text-[16px] font-extrabold text-cd-text">
                  {title ?? ""}
                </Text>
                <IconButton icon="close" onPress={onClose} />
              </View>
              <View className="px-4 py-4">{children}</View>
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
