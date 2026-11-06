import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView } from 'expo-camera';

/**
 * 대화방 사진 촬영 — 명함·영수증 화면과 같은 자체 카메라(absolute 전체 덮개).
 * iOS 시스템 사진 선택기가 결과를 잃는 문제(card.tsx 실측) 때문에 시스템 카메라 대신 expo-camera 를 쓴다.
 * 권한 요청은 여는 쪽(useCameraPermissions)이 먼저 한다.
 */
export function ChatCamera({
  onClose,
  onShot,
  onError,
}: {
  onClose: () => void;
  onShot: (uri: string) => void;
  onError: (message: string) => void;
}) {
  const cameraRef = useRef<CameraView>(null);
  const [shooting, setShooting] = useState(false);

  const shoot = async () => {
    if (shooting) return;
    setShooting(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.6 });
      onClose();
      if (photo?.uri) onShot(photo.uri);
      else onError('촬영에 실패했습니다. 다시 시도해주세요.');
    } catch (e) {
      onClose();
      onError(`촬영 중 오류가 발생했습니다: ${(e as Error).message}`);
    } finally {
      setShooting(false);
    }
  };

  return (
    <View className="absolute inset-0 z-50 bg-black">
      <CameraView
        ref={cameraRef}
        style={{ flex: 1 }}
        facing="back"
        onMountError={(e) => {
          onClose();
          onError(`카메라를 열 수 없습니다: ${e.message}`);
        }}
      />
      <View className="absolute bottom-0 left-0 right-0 flex-row items-center justify-between px-10 pb-12 pt-6">
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="촬영 취소"
          className="h-12 w-12 items-center justify-center rounded-full bg-black/50 active:opacity-70">
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
        <Pressable
          onPress={() => void shoot()}
          disabled={shooting}
          accessibilityRole="button"
          accessibilityLabel="촬영"
          className="h-[72px] w-[72px] items-center justify-center rounded-full border-4 border-white active:opacity-70">
          {shooting ? <ActivityIndicator color="#fff" /> : <View className="h-14 w-14 rounded-full bg-cd-card" />}
        </Pressable>
        <View className="h-12 w-12" />
      </View>
    </View>
  );
}
