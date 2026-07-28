import { Text, View } from "react-native";

import { Button } from "./Button";
import { Sheet } from "./Sheet";

/**
 * 확인 시트 — 파괴적 액션(삭제·반려 등) 앞에 둔다.
 *
 * ⚠ RN `Alert.alert` 대신 자체 시트를 쓰는 이유: 웹에서 `window.confirm` 이 브라우저의
 * '추가 대화상자 차단' 상태면 항상 false 가 되어 삭제가 조용히 취소되던 사고가 있었다.
 * 확인 UI 는 앱이 직접 그린다는 규칙을 모바일에도 동일하게 적용한다.
 */
export function ConfirmSheet({
  visible,
  title,
  message,
  confirmLabel = "확인",
  danger,
  onConfirm,
  onCancel,
  loading,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}) {
  return (
    <Sheet
      visible={visible}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <View className="flex-1">
            <Button label="취소" variant="ghost" onPress={onCancel} full />
          </View>
          <View className="flex-1">
            <Button
              label={confirmLabel}
              variant={danger ? "danger" : "primary"}
              onPress={onConfirm}
              loading={loading}
              full
            />
          </View>
        </>
      }>
      <Text className="text-[14px] leading-6 text-cd-muted">{message ?? ""}</Text>
    </Sheet>
  );
}
