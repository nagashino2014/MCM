import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';

import { DatePickerSheet } from '@/components/calendar/DatePickerSheet';
import { CtaGradientFill } from '@/components/ui';
import { apiFetch } from '@/lib/api';

// 개인카드 영수증 촬영 (accounting-expansion 블루프린트 §2, P1)
// 명함 촬영(card.tsx)의 형제 화면 — 찍고 → AI 인식 결과 확인 → 저장(스톡).
// 저장해 둔 영수증은 웹 지출결의서·출장보고서 기안 화면의 "개인카드 영수증 불러오기"에서 사용된다.
// 회계 용어(계정과목·공급가액 등)는 노출하지 않는다 — 분류·부가세 분해는 서버가 자동 처리.

interface ReceiptFields {
  storeName: string | null;
  storeCorpNum: string | null;
  paidAt: string | null;
  totalAmount: number | null;
  supplyAmount: number | null;
  taxAmount: number | null;
  cardLast4: string | null;
  approvalNum: string | null;
  items: string[];
}
interface DuplicateInfo {
  receiptId: string;
  paidAt: string | null;
  storeName: string | null;
  totalAmount: number;
}
type Step = 'pick' | 'parsing' | 'form' | 'saving' | 'done';

const PRIMARY = '#4A63D8';

/** 표시용 000-00-00000 (10자리가 아니면 입력값 그대로 둔다 — 타이핑 중 되돌림 금지). */
const fmtCorpNum = (v: string) => {
  const d = v.replace(/[^0-9]/g, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : v;
};

// 라우트 크래시 캐처 — 화면 오류 시 흰 화면 대신 안내+재시도 제공
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  return (
    <SafeAreaView className="flex-1 items-center justify-center bg-cd-bg px-6">
      <Text className="mb-2 text-base font-bold text-cd-error">화면 오류가 발생했습니다</Text>
      <Text className="mb-4 text-center text-xs text-cd-muted">
        {error.name}: {error.message}
      </Text>
      <Pressable onPress={() => void retry()} className="rounded-xl bg-primary px-5 py-2.5">
        <Text className="font-bold text-white">다시 시도</Text>
      </Pressable>
    </SafeAreaView>
  );
}

export default function ReceiptScreen() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('pick');
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  // 안내(자동 보정 결과) — 경고와 톤을 나눈다. 경고=사용자 확인 필요, 안내=이미 처리됨.
  const [notices, setNotices] = useState<string[]>([]);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ReceiptFields | null>(null);
  // 확인 폼 — 파싱 결과를 문자열 버퍼로 편집(AGENTS.md: controlled input 에 정규화 함수 금지)
  // 사용일은 자유 입력이던 것을 달력 선택으로 바꿨다 — 표기가 제각각이면 목록·피커의 기간 필터에서
  // 빠져 "저장했는데 안 보이는" 건이 생긴다(2026-08-19 원인 분석). 시각만 선택 입력으로 남긴다.
  const [form, setForm] = useState({
    storeName: '',
    corpNum: '',
    paidDate: '',
    paidTime: '',
    totalAmount: '',
    cardLast4: '',
    memo: '',
  });
  const [looking, setLooking] = useState(false);
  const [datePicker, setDatePicker] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateInfo[] | null>(null);
  const [savedStore, setSavedStore] = useState<string | null>(null);
  // 자체 카메라(expo-camera) — 명함 화면과 동일(iOS 시스템 픽커 promise 유실 버그 대체)
  const [cameraOpen, setCameraOpen] = useState(false);
  const [shooting, setShooting] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const [camPerm, requestCamPerm] = useCameraPermissions();

  const openCamera = async () => {
    setError(null);
    if (!camPerm?.granted) {
      const r = await requestCamPerm();
      if (!r.granted) {
        setError('카메라 권한이 필요합니다. 설정에서 허용해주세요.');
        return;
      }
    }
    setCameraOpen(true);
  };

  const shoot = async () => {
    if (shooting) return;
    setShooting(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.6 });
      setCameraOpen(false);
      if (photo?.uri) {
        void handleImage(photo.uri);
      } else {
        setError('촬영에 실패했습니다. 다시 시도해주세요.');
      }
    } catch (e) {
      setCameraOpen(false);
      setError(`촬영 중 오류가 발생했습니다: ${(e as Error).message}`);
    } finally {
      setShooting(false);
    }
  };

  const pick = async (source: 'camera' | 'library') => {
    setError(null);
    try {
      const perm =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setError('카메라/사진 접근 권한이 필요합니다.');
        return;
      }
      // iOS promise 유실 버그 회피 — 명함 화면과 동일 옵션
      const opts: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        quality: 0.6,
        allowsEditing: false,
        presentationStyle: ImagePicker.UIImagePickerPresentationStyle.FULL_SCREEN,
      };
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(opts)
          : await ImagePicker.launchImageLibraryAsync(opts);
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) {
        setError('이미지를 가져오지 못했습니다. 다시 시도해주세요.');
        return;
      }
      void handleImage(asset.uri);
    } catch (e) {
      setError(`이미지 선택 중 오류가 발생했습니다: ${(e as Error).message}`);
    }
  };

  const handleImage = async (uri: string) => {
    setImageUri(uri);
    setWarnings([]);
    setNotices([]);
    setStep('parsing');
    try {
      const fd = new FormData();
      // SDK 57 winter fetch — expo-file-system File 클래스로 표준 File 파트 구성(명함 실측)
      fd.append('file', new File(uri) as unknown as Blob, 'receipt.jpg');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60_000);
      const res = await apiFetch('/api/receipts/parse', {
        method: 'POST',
        body: fd,
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
      const data = (await res.json().catch(() => ({}))) as {
        fields?: ReceiptFields | null;
        warning?: string;
        warnings?: string[];
        notices?: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const fields = data.fields ?? null;
      setWarnings([...(data.warning ? [data.warning] : []), ...(data.warnings ?? [])]);
      setNotices(data.notices ?? []);
      setParsed(fields);
      const paidAt = fields?.paidAt ?? '';
      setForm({
        storeName: fields?.storeName ?? '',
        corpNum: fmtCorpNum(fields?.storeCorpNum ?? ''),
        paidDate: paidAt.slice(0, 10),
        paidTime: paidAt.length > 10 ? paidAt.slice(11, 16) : '',
        totalAmount: fields?.totalAmount != null ? String(fields.totalAmount) : '',
        cardLast4: fields?.cardLast4 ?? '',
        memo: '',
      });
      setDuplicates(null);
      setStep('form');
    } catch (e) {
      setError(`영수증 인식에 실패했습니다: ${(e as Error).message}`);
      setStep('pick');
    }
  };

  const save = async (force: boolean) => {
    const amount = Number(form.totalAmount.replace(/[^0-9]/g, ''));
    if (!(amount > 0)) {
      setError('결제 금액을 입력하세요.');
      return;
    }
    if (!imageUri) {
      setError('영수증 이미지가 없습니다. 다시 촬영해주세요.');
      return;
    }
    setError(null);
    setStep('saving');
    try {
      const fields: ReceiptFields = {
        storeName: form.storeName.trim() || null,
        storeCorpNum: form.corpNum.replace(/[^0-9]/g, '') || null,
        paidAt: form.paidDate ? (form.paidTime.trim() ? `${form.paidDate} ${form.paidTime.trim()}` : form.paidDate) : null,
        totalAmount: amount,
        // 공급가액·부가세는 서버가 검증·역산(사용자 수정 금액 기준으로 재계산되도록 원 파싱값 전달)
        supplyAmount: parsed?.totalAmount === amount ? (parsed?.supplyAmount ?? null) : null,
        taxAmount: parsed?.totalAmount === amount ? (parsed?.taxAmount ?? null) : null,
        cardLast4: form.cardLast4.replace(/[^0-9]/g, '').slice(-4) || null,
        approvalNum: parsed?.approvalNum ?? null,
        items: parsed?.items ?? [],
      };
      const fd = new FormData();
      fd.append('file', new File(imageUri) as unknown as Blob, 'receipt.jpg');
      fd.append('fields', JSON.stringify(fields));
      if (parsed) fd.append('parsed', JSON.stringify(parsed));
      if (form.memo.trim()) fd.append('memo', form.memo.trim());
      if (force) fd.append('force', '1');
      const res = await apiFetch('/api/receipts', { method: 'POST', body: fd });
      const data = (await res.json().catch(() => ({}))) as {
        receipt?: unknown;
        duplicates?: DuplicateInfo[];
        error?: string;
      };
      if (res.status === 409 && data.duplicates) {
        setDuplicates(data.duplicates);
        setStep('form');
        return;
      }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSavedStore(form.storeName.trim() || '영수증');
      setStep('done');
    } catch (e) {
      setError((e as Error).message);
      setStep('form');
    }
  };

  /** 사업자번호로 상호를 찾아 채운다(내부 거래 이력 조회). 못 찾으면 안내만 남긴다. */
  const lookupStore = async () => {
    const digits = form.corpNum.replace(/[^0-9]/g, '');
    if (digits.length !== 10) {
      setWarnings((w) => [...w, '사업자번호 10자리를 입력해 주세요.']);
      return;
    }
    setLooking(true);
    try {
      const res = await apiFetch(`/api/receipts/store-lookup?corpNum=${digits}`);
      const d = (await res.json().catch(() => ({}))) as {
        store?: { storeName: string | null } | null;
        message?: string | null;
        error?: string;
      };
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      if (d.store?.storeName) {
        setForm((s) => ({ ...s, storeName: d.store!.storeName as string }));
        setNotices((n) => [...n, `상호를 "${d.store!.storeName}"(으)로 채웠습니다.`]);
      } else if (d.message) {
        setNotices((n) => [...n, d.message as string]);
      }
    } catch (e) {
      setError(`상호를 찾지 못했습니다: ${(e as Error).message}`);
    } finally {
      setLooking(false);
    }
  };

  const reset = () => {
    setStep('pick');
    setError(null);
    setWarnings([]);
    setNotices([]);
    setImageUri(null);
    setParsed(null);
    setForm({ storeName: '', corpNum: '', paidDate: '', paidTime: '', totalAmount: '', cardLast4: '', memo: '' });
    setDuplicates(null);
    setSavedStore(null);
  };

  return (
    <SafeAreaView className="flex-1 bg-cd-bg">
      {/* 자체 헤더 — 명함 화면과 동일(expo-router 헤더 점멸 회피) */}
      <View className="flex-row items-center gap-2 border-b border-cd-border bg-cd-card px-2 py-2">
        <Pressable onPress={() => router.back()} className="h-10 w-10 items-center justify-center active:opacity-60">
          <Ionicons name="chevron-back" size={24} color={PRIMARY} />
        </Pressable>
        <Text className="flex-1 text-base font-extrabold text-cd-text">영수증 촬영</Text>
        <Pressable
          onPress={() => router.push('/receipts')}
          hitSlop={8}
          className="h-10 w-10 items-center justify-center active:opacity-60">
          <Ionicons name="file-tray-full-outline" size={21} color={PRIMARY} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {error ? (
          <View className="rounded-xl bg-cd-error-soft px-4 py-3">
            <Text className="text-sm text-cd-error">{error}</Text>
          </View>
        ) : null}
        {warnings.length ? (
          <View className="gap-1 rounded-xl bg-cd-warning-soft px-4 py-3">
            {warnings.map((w, i) => (
              <Text key={i} className="text-sm text-cd-warning">
                {w}
              </Text>
            ))}
          </View>
        ) : null}
        {notices.length ? (
          <View className="gap-1 rounded-xl bg-cd-primary-soft px-4 py-3">
            {notices.map((n, i) => (
              <Text key={i} className="text-sm text-cd-primary">
                {n}
              </Text>
            ))}
          </View>
        ) : null}

        {imageUri && step !== 'pick' ? (
          <Image
            source={{ uri: imageUri }}
            resizeMode="contain"
            className="h-44 w-full rounded-2xl border border-cd-border"
          />
        ) : null}

        {step === 'pick' ? (
          <View className="gap-3">
            <Pressable
              onPress={openCamera}
              className="h-14 flex-row items-center justify-center gap-2 overflow-hidden rounded-2xl active:opacity-80">
              <CtaGradientFill />
              <Ionicons name="receipt" size={20} color="#fff" />
              <Text className="text-base font-bold text-white">영수증 촬영</Text>
            </Pressable>
            {Platform.OS !== 'ios' ? (
              <Pressable
                onPress={() => pick('library')}
                className="h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-primary-light active:opacity-70">
                <Ionicons name="images" size={20} color={PRIMARY} />
                <Text className="text-base font-bold text-primary">앨범에서 선택</Text>
              </Pressable>
            ) : null}
            <Text className="mt-1 text-center text-xs text-cd-faint">
              개인카드로 결제한 지류 영수증을 찍어두면{'\n'}지출결의서·출장보고서 작성 때 자동으로 불러올 수 있습니다.
            </Text>
          </View>
        ) : null}

        {step === 'parsing' ? (
          <View className="flex-row items-center justify-center gap-2 py-8">
            <ActivityIndicator color={PRIMARY} />
            <Text className="text-sm text-cd-muted">영수증을 인식하는 중…</Text>
          </View>
        ) : null}

        {step === 'form' || step === 'saving' ? (
          <View className="gap-3">
            {duplicates?.length ? (
              <View className="gap-2 rounded-xl bg-cd-warning-soft px-4 py-3">
                <Text className="text-sm font-bold text-cd-warning">이미 저장된 영수증일 수 있어요</Text>
                {duplicates.map((d) => (
                  <Text key={d.receiptId} className="text-xs text-cd-warning">
                    · {d.paidAt ?? '-'} {d.storeName ?? '상호 미상'} {d.totalAmount.toLocaleString('ko-KR')}원
                  </Text>
                ))}
                <Pressable
                  onPress={() => void save(true)}
                  disabled={step === 'saving'}
                  className="mt-1 items-center rounded-lg border border-cd-border bg-cd-card py-2 active:opacity-70">
                  <Text className="text-sm font-bold text-cd-text">다른 결제 건이 맞아요 — 그래도 저장</Text>
                </Pressable>
              </View>
            ) : null}

            <View className="gap-2 rounded-2xl border border-cd-border bg-cd-card p-3">
              <Text className="text-xs font-bold text-cd-muted">인식 결과 확인 — 틀린 곳만 고쳐주세요</Text>
              <Field label="상호" value={form.storeName} onChange={(v) => setForm((s) => ({ ...s, storeName: v }))} />
              <View className="flex-row items-center gap-2">
                <Text className="w-16 text-xs text-cd-faint">사업자번호</Text>
                <TextInput
                  className="flex-1 rounded-lg border border-cd-border px-3 py-2 text-base text-cd-text"
                  value={form.corpNum}
                  onChangeText={(v) => setForm((s) => ({ ...s, corpNum: v }))}
                  keyboardType="numbers-and-punctuation"
                  placeholder="000-00-00000"
                  placeholderTextColor="#9ca3af"
                />
                <Pressable
                  onPress={() => void lookupStore()}
                  disabled={looking}
                  className="rounded-lg border border-cd-border px-3 py-2.5 active:opacity-70">
                  {looking ? (
                    <ActivityIndicator size="small" color={PRIMARY} />
                  ) : (
                    <Text className="text-xs font-bold text-primary">상호 찾기</Text>
                  )}
                </Pressable>
              </View>
              <View className="flex-row items-center gap-2">
                <Text className="w-16 text-xs text-cd-faint">사용일</Text>
                <Pressable
                  onPress={() => setDatePicker(true)}
                  className="flex-1 flex-row items-center justify-between rounded-lg border border-cd-border px-3 py-2.5 active:opacity-70">
                  <Text className={`text-base ${form.paidDate ? 'text-cd-text' : 'text-cd-faint'}`}>
                    {form.paidDate || '날짜 선택'}
                  </Text>
                  <Ionicons name="calendar-outline" size={16} color="#6b7280" />
                </Pressable>
              </View>
              <Field
                label="시각"
                value={form.paidTime}
                onChange={(v) => setForm((s) => ({ ...s, paidTime: v }))}
                placeholder="12:30 (선택)"
              />
              <Field
                label="금액 *"
                value={form.totalAmount}
                onChange={(v) => setForm((s) => ({ ...s, totalAmount: v }))}
                keyboardType="number-pad"
              />
              <Field
                label="카드 끝4"
                value={form.cardLast4}
                onChange={(v) => setForm((s) => ({ ...s, cardLast4: v }))}
                keyboardType="number-pad"
              />
              <Field label="메모" value={form.memo} onChange={(v) => setForm((s) => ({ ...s, memo: v }))} placeholder="(선택)" />
            </View>

            <View className="flex-row gap-2">
              <Pressable
                onPress={reset}
                disabled={step === 'saving'}
                className="items-center justify-center rounded-xl border border-cd-border px-4 py-3 active:opacity-70">
                <Ionicons name="refresh" size={18} color="#6b7280" />
              </Pressable>
              <Pressable
                onPress={() => void save(false)}
                disabled={step === 'saving'}
                className="h-12 flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-primary active:opacity-80">
                {step === 'saving' ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={18} color="#fff" />
                    <Text className="text-base font-bold text-white">저장</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        ) : null}

        {step === 'done' ? (
          <View className="items-center gap-3 rounded-2xl border border-cd-border bg-cd-card p-6">
            <View className="rounded-full bg-cd-success-soft p-3">
              <Ionicons name="checkmark" size={28} color="#16a34a" />
            </View>
            <Text className="text-center text-sm font-bold text-cd-text">
              {savedStore} 영수증을 저장했습니다.{'\n'}보관함에서 확인하고, 지출결의서 작성 때 불러올 수 있어요.
            </Text>
            <View className="flex-row gap-2">
              <Pressable
                onPress={reset}
                className="flex-row items-center gap-1 rounded-xl bg-primary px-4 py-2.5 active:opacity-80">
                <Ionicons name="camera" size={16} color="#fff" />
                <Text className="font-bold text-white">다음 영수증</Text>
              </Pressable>
              <Pressable
                onPress={() => router.back()}
                className="rounded-xl border border-cd-border px-4 py-2.5 active:opacity-70">
                <Text className="font-semibold text-cd-text">완료</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>

      <DatePickerSheet
        visible={datePicker}
        title="사용일 선택"
        value={form.paidDate || null}
        onConfirm={(from) => {
          setForm((s) => ({ ...s, paidDate: from }));
          setDatePicker(false);
        }}
        onClose={() => setDatePicker(false)}
      />

      {/* 자체 카메라 — 명함 화면과 동일한 absolute 전체 덮개 */}
      {cameraOpen ? (
        <View className="absolute inset-0 z-50 bg-black">
          <CameraView
            ref={cameraRef}
            style={{ flex: 1 }}
            facing="back"
            onMountError={(e) => {
              setCameraOpen(false);
              setError(`카메라를 열 수 없습니다: ${e.message}`);
            }}
          />
          <View className="absolute left-0 right-0 top-16 items-center">
            <Text className="rounded-full bg-black/50 px-4 py-1.5 text-sm text-white">
              영수증 전체가 잘 보이게 찍어주세요 — 긴 영수증은 금액 부분 위주로
            </Text>
          </View>
          <View className="absolute bottom-0 left-0 right-0 flex-row items-center justify-between px-10 pb-12 pt-6">
            <Pressable
              onPress={() => setCameraOpen(false)}
              className="h-12 w-12 items-center justify-center rounded-full bg-black/50 active:opacity-70">
              <Ionicons name="close" size={26} color="#fff" />
            </Pressable>
            <Pressable
              onPress={shoot}
              disabled={shooting}
              className="h-[72px] w-[72px] items-center justify-center rounded-full border-4 border-white active:opacity-70">
              {shooting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <View className="h-14 w-14 rounded-full bg-cd-card" />
              )}
            </Pressable>
            <View className="h-12 w-12" />
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChange,
  keyboardType,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  keyboardType?: 'number-pad';
  placeholder?: string;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <Text className="w-16 text-xs text-cd-faint">{label}</Text>
      <TextInput
        className="flex-1 rounded-lg border border-cd-border px-3 py-2 text-base text-cd-text"
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        autoCapitalize="none"
      />
    </View>
  );
}
