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

import { apiFetch, apiJson } from '@/lib/api';

interface CardFields {
  personName: string | null;
  title: string | null;
  department: string | null;
  companyName: string | null;
  mobilePhone: string | null;
  officePhone: string | null;
  faxNumber: string | null;
  email: string | null;
  address: string | null;
  etc: string | null;
}
interface FacilityOption {
  facilityId: string;
  companyName: string;
  siteAddress: string | null;
}
type Step = 'pick' | 'parsing' | 'form' | 'saving' | 'done';

const PRIMARY = '#4A63D8';

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

export default function CardScreen() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('pick');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [parsed, setParsed] = useState<CardFields | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [facilityQuery, setFacilityQuery] = useState('');
  const [facilityOptions, setFacilityOptions] = useState<FacilityOption[]>([]);
  const [facility, setFacility] = useState<FacilityOption | null>(null);
  const [savedMode, setSavedMode] = useState<'created' | 'updated' | null>(null);
  // 간이 등록
  const [quickOpen, setQuickOpen] = useState(false);
  const [quick, setQuick] = useState({ companyName: '', siteAddress: '', phoneNumber: '' });
  const [quickSaving, setQuickSaving] = useState(false);
  // 자체 카메라(expo-camera) — iOS 시스템 픽커(promise 유실 버그, diag-2/3 실측) 대체
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

  const searchFacilities = async (q: string) => {
    if (!q.trim()) {
      setFacilityOptions([]);
      return;
    }
    try {
      const d = await apiJson<{ items: FacilityOption[] }>(
        `/api/facilities?q=${encodeURIComponent(q.trim())}&limit=5&sort=name`
      );
      setFacilityOptions(d.items ?? []);
    } catch {
      // 검색 실패는 조용히
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
      // iOS promise 유실 버그 회피: 크롭(allowsEditing) 제거 + FULL_SCREEN 강제.
      // 크롭 화면·pageSheet 모달에서 launchCameraAsync 가 영원히 pending 되는 사례 다수(expo#13221 등).
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
    setWarning(null);
    setStep('parsing');
    try {
      const fd = new FormData();
      // SDK 57 winter fetch는 RN 스타일 {uri,name,type} 파트를 거부(Unsupported FormDataPart,
      // 실측) → expo-file-system File 클래스로 표준 File 파트 구성
      fd.append('file', new File(uri) as unknown as Blob, 'card.jpg');
      // 진단용 타임아웃(60s) — 행이면 무한 스피너 대신 에러로 떨어뜨린다
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60_000);
      const res = await apiFetch('/api/facilities/business-card/parse', {
        method: 'POST',
        body: fd,
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
      const data = (await res.json().catch(() => ({}))) as {
        fields?: CardFields;
        warning?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const fields = data.fields ?? null;
      if (data.warning) setWarning(data.warning);
      setParsed(fields);
      setForm({
        personName: fields?.personName ?? '',
        title: fields?.title ?? '',
        departmentName: fields?.department ?? '',
        mobilePhone: fields?.mobilePhone ?? '',
        officePhone: fields?.officePhone ?? '',
        email: fields?.email ?? '',
      });
      const company = fields?.companyName ?? '';
      setFacilityQuery(company);
      setFacility(null);
      setQuick({
        companyName: company,
        siteAddress: fields?.address ?? '',
        phoneNumber: fields?.officePhone ?? '',
      });
      if (company) await searchFacilities(company);
      setStep('form');
    } catch (e) {
      setError(`명함 인식에 실패했습니다: ${(e as Error).message}`);
      setStep('pick');
    }
  };

  const save = async () => {
    if (!facility) {
      setError('사업장을 선택하세요.');
      return;
    }
    if (!form.personName?.trim()) {
      setError('이름은 필수입니다.');
      return;
    }
    setError(null);
    setStep('saving');
    try {
      const fd = new FormData();
      if (imageUri) fd.append('file', new File(imageUri) as unknown as Blob, 'card.jpg');
      fd.append('fields', JSON.stringify(form));
      if (parsed) fd.append('parsed', JSON.stringify(parsed));
      const res = await apiFetch(
        `/api/facilities/${encodeURIComponent(facility.facilityId)}/contacts/card`,
        { method: 'POST', body: fd }
      );
      const data = (await res.json().catch(() => ({}))) as { mode?: 'created' | 'updated'; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSavedMode(data.mode ?? 'created');
      setStep('done');
    } catch (e) {
      setError((e as Error).message);
      setStep('form');
    }
  };

  const quickRegister = async () => {
    if (!quick.companyName.trim() || !quick.siteAddress.trim()) {
      setError('사업장명과 소재지는 필수입니다.');
      return;
    }
    setQuickSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/api/facilities/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          companyName: quick.companyName.trim(),
          siteAddress: quick.siteAddress.trim(),
          phoneNumber: quick.phoneNumber.trim() || null,
          source: 'mobile-quick',
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        facilityId?: string;
        duplicateFacility?: { facilityId: string; companyName: string | null; siteAddress: string | null };
        error?: string;
      };
      if (res.status === 409 && data.duplicateFacility) {
        const dup = data.duplicateFacility;
        setFacility({
          facilityId: dup.facilityId,
          companyName: dup.companyName ?? quick.companyName,
          siteAddress: dup.siteAddress,
        });
        setQuickOpen(false);
        setWarning('이미 등록된 사업장이라 기존 사업장을 선택했습니다.');
        return;
      }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setFacility({
        facilityId: String(data.facilityId),
        companyName: quick.companyName.trim(),
        siteAddress: quick.siteAddress.trim(),
      });
      setQuickOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setQuickSaving(false);
    }
  };

  const reset = () => {
    setStep('pick');
    setError(null);
    setWarning(null);
    setImageUri(null);
    setParsed(null);
    setForm({});
    setFacility(null);
    setFacilityQuery('');
    setFacilityOptions([]);
    setSavedMode(null);
    setQuickOpen(false);
    setQuick({ companyName: '', siteAddress: '', phoneNumber: '' });
  };

  return (
    <SafeAreaView className="flex-1 bg-cd-bg">
      {/* 자체 헤더 — 화면 내 <Stack.Screen options> 동적 갱신이 iOS에서 헤더 점멸 루프를
          일으켜(cam1~3 실측) expo-router 헤더 대신 직접 렌더한다 */}
      <View className="flex-row items-center gap-2 border-b border-cd-border bg-cd-card px-2 py-2">
        <Pressable onPress={() => router.back()} className="h-10 w-10 items-center justify-center active:opacity-60">
          <Ionicons name="chevron-back" size={24} color={PRIMARY} />
        </Pressable>
        <Text className="text-base font-extrabold text-cd-text">명함 촬영</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {error ? (
          <View className="rounded-xl bg-cd-error-soft px-4 py-3">
            <Text className="text-sm text-cd-error">{error}</Text>
          </View>
        ) : null}
        {warning ? (
          <View className="rounded-xl bg-cd-warning-soft px-4 py-3">
            <Text className="text-sm text-cd-warning">{warning}</Text>
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
              className="h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-primary active:opacity-80">
              <Ionicons name="camera" size={20} color="#fff" />
              <Text className="text-base font-bold text-white">명함 촬영</Text>
            </Pressable>
            {/* iOS 는 expo-image-picker 가 결과를 반환하지 않는 문제(1.0.1 실측)로 앨범 숨김.
                안드로이드는 유지 — 동작 시 촬영 없이 저장된 명함 선택 가능 */}
            {Platform.OS !== 'ios' ? (
              <Pressable
                onPress={() => pick('library')}
                className="h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-primary-light active:opacity-70">
                <Ionicons name="images" size={20} color={PRIMARY} />
                <Text className="text-base font-bold text-primary">앨범에서 선택</Text>
              </Pressable>
            ) : null}
            <Text className="mt-1 text-center text-xs text-cd-faint">
              촬영한 명함은 AI가 자동으로 인식해 담당자 정보로 정리합니다.
            </Text>
            <Text className="text-center text-[10px] text-cd-faint">v1.1.0</Text>
          </View>
        ) : null}

        {step === 'parsing' ? (
          <View className="flex-row items-center justify-center gap-2 py-8">
            <ActivityIndicator color={PRIMARY} />
            <Text className="text-sm text-cd-muted">명함을 인식하는 중…</Text>
          </View>
        ) : null}

        {step === 'form' || step === 'saving' ? (
          <View className="gap-3">
            {/* 사업장 선택 */}
            <View className="rounded-2xl border border-cd-border bg-cd-card p-3">
              <Text className="mb-2 text-xs font-bold text-cd-muted">사업장 선택 *</Text>
              {facility ? (
                <View className="flex-row items-center gap-2 rounded-xl bg-primary-light px-3 py-2.5">
                  <Ionicons name="checkmark-circle" size={18} color={PRIMARY} />
                  <View className="flex-1">
                    <Text className="text-sm font-bold text-cd-text">
                      {facility.companyName}
                    </Text>
                    {facility.siteAddress ? (
                      <Text className="text-xs text-cd-muted">{facility.siteAddress}</Text>
                    ) : null}
                  </View>
                  <Pressable onPress={() => setFacility(null)} className="active:opacity-60">
                    <Text className="text-xs font-semibold text-primary">변경</Text>
                  </Pressable>
                </View>
              ) : (
                <View className="gap-2">
                  <View className="flex-row gap-2">
                    <TextInput
                      className="flex-1 rounded-xl border border-cd-border px-3 py-2 text-base text-cd-text"
                      placeholder="사업장명 검색"
                      placeholderTextColor="#9ca3af"
                      value={facilityQuery}
                      onChangeText={setFacilityQuery}
                      onSubmitEditing={() => searchFacilities(facilityQuery)}
                      returnKeyType="search"
                    />
                    <Pressable
                      onPress={() => searchFacilities(facilityQuery)}
                      className="items-center justify-center rounded-xl bg-primary-light px-4 active:opacity-70">
                      <Ionicons name="search" size={18} color={PRIMARY} />
                    </Pressable>
                  </View>
                  {facilityOptions.map((f) => (
                    <Pressable
                      key={f.facilityId}
                      onPress={() => setFacility(f)}
                      className="rounded-xl border border-cd-border px-3 py-2 active:opacity-70">
                      <Text className="text-sm font-bold text-cd-text">
                        {f.companyName}
                      </Text>
                      <Text className="text-xs text-cd-muted">{f.siteAddress ?? '—'}</Text>
                    </Pressable>
                  ))}
                  {quickOpen ? (
                    <View className="mt-1 gap-2 rounded-xl border border-cd-border p-3">
                      <Text className="text-xs font-bold text-cd-text">
                        신규 사업장 간이 등록
                      </Text>
                      <QuickField
                        label="사업장명 *"
                        value={quick.companyName}
                        onChange={(v) => setQuick((s) => ({ ...s, companyName: v }))}
                      />
                      <QuickField
                        label="소재지 *"
                        value={quick.siteAddress}
                        onChange={(v) => setQuick((s) => ({ ...s, siteAddress: v }))}
                      />
                      <QuickField
                        label="대표전화"
                        value={quick.phoneNumber}
                        onChange={(v) => setQuick((s) => ({ ...s, phoneNumber: v }))}
                      />
                      <Pressable
                        onPress={quickRegister}
                        disabled={quickSaving}
                        className="mt-1 items-center rounded-xl bg-primary py-2.5 active:opacity-80">
                        {quickSaving ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <Text className="font-bold text-white">등록하고 선택</Text>
                        )}
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => setQuickOpen(true)}
                      className="mt-1 flex-row items-center justify-center gap-1 rounded-xl bg-primary-light py-2.5 active:opacity-70">
                      <Ionicons name="add" size={18} color={PRIMARY} />
                      <Text className="font-bold text-primary">신규 사업장 간이 등록</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>

            {/* 담당자 정보 */}
            <View className="gap-2 rounded-2xl border border-cd-border bg-cd-card p-3">
              <Text className="text-xs font-bold text-cd-muted">담당자 정보</Text>
              <FormField label="이름 *" value={form.personName ?? ''} onChange={(v) => setForm((s) => ({ ...s, personName: v }))} />
              <FormField label="직급" value={form.title ?? ''} onChange={(v) => setForm((s) => ({ ...s, title: v }))} />
              <FormField label="부서" value={form.departmentName ?? ''} onChange={(v) => setForm((s) => ({ ...s, departmentName: v }))} />
              <FormField label="휴대폰" value={form.mobilePhone ?? ''} onChange={(v) => setForm((s) => ({ ...s, mobilePhone: v }))} keyboardType="phone-pad" />
              <FormField label="사무실" value={form.officePhone ?? ''} onChange={(v) => setForm((s) => ({ ...s, officePhone: v }))} keyboardType="phone-pad" />
              <FormField label="이메일" value={form.email ?? ''} onChange={(v) => setForm((s) => ({ ...s, email: v }))} keyboardType="email-address" />
            </View>

            <View className="flex-row gap-2">
              <Pressable
                onPress={reset}
                disabled={step === 'saving'}
                className="items-center justify-center rounded-xl border border-cd-border px-4 py-3 active:opacity-70">
                <Ionicons name="refresh" size={18} color="#6b7280" />
              </Pressable>
              <Pressable
                onPress={save}
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
              {form.personName} 님을 {facility?.companyName}에{' '}
              {savedMode === 'updated' ? '갱신' : '등록'}했습니다.
            </Text>
            <View className="flex-row gap-2">
              <Pressable
                onPress={reset}
                className="flex-row items-center gap-1 rounded-xl bg-primary px-4 py-2.5 active:opacity-80">
                <Ionicons name="camera" size={16} color="#fff" />
                <Text className="font-bold text-white">다음 명함</Text>
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

      {/* 자체 카메라 — RN Modal 은 expo-router modal presentation 과 충돌(iOS 점멸 실측)
          → 같은 화면 안에서 absolute 전체 덮개로 렌더 */}
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
          {/* 명함 가이드 문구 */}
          <View className="absolute left-0 right-0 top-16 items-center">
            <Text className="rounded-full bg-black/50 px-4 py-1.5 text-sm text-white">
              명함이 잘 보이게만 찍으면 돼요 — 방향·크기 자유
            </Text>
          </View>
          {/* 하단 컨트롤 */}
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

function FormField({
  label,
  value,
  onChange,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  keyboardType?: 'phone-pad' | 'email-address';
}) {
  return (
    <View className="flex-row items-center gap-2">
      <Text className="w-16 text-xs text-cd-faint">{label}</Text>
      <TextInput
        className="flex-1 rounded-lg border border-cd-border px-3 py-2 text-base text-cd-text"
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        autoCapitalize="none"
      />
    </View>
  );
}

function QuickField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <Text className="w-16 text-xs text-cd-faint">{label}</Text>
      <TextInput
        className="flex-1 rounded-lg border border-cd-border px-3 py-2 text-sm text-cd-text"
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
      />
    </View>
  );
}
