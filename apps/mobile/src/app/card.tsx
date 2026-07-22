import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

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

const PRIMARY = '#5D87FF';

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
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('카메라/사진 접근 권한이 필요합니다.');
      return;
    }
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: true })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.6, allowsEditing: true });
    if (result.canceled) return;
    void handleImage(result.assets[0].uri);
  };

  const handleImage = async (uri: string) => {
    setImageUri(uri);
    setWarning(null);
    setStep('parsing');
    try {
      const fd = new FormData();
      // RN FormData 파일 형식
      fd.append('file', { uri, name: 'card.jpg', type: 'image/jpeg' } as unknown as Blob);
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
      // 진단 강화: 에러 유형·URI 스킴까지 표시(TestFlight 원격 디버깅용)
      const err = e as Error;
      const scheme = uri.split(':')[0];
      setError(`[인식 실패] ${err.name}: ${err.message} (img=${scheme})`);
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
      if (imageUri) fd.append('file', { uri: imageUri, name: 'card.jpg', type: 'image/jpeg' } as unknown as Blob);
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
    <SafeAreaView edges={['bottom']} className="flex-1 bg-neutral-50 dark:bg-neutral-950">
      <Stack.Screen options={{ title: '명함 촬영', headerShown: true }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {error ? (
          <View className="rounded-xl bg-red-50 px-4 py-3 dark:bg-red-950">
            <Text className="text-sm text-red-600 dark:text-red-300">{error}</Text>
          </View>
        ) : null}
        {warning ? (
          <View className="rounded-xl bg-amber-50 px-4 py-3 dark:bg-amber-950">
            <Text className="text-sm text-amber-700 dark:text-amber-300">{warning}</Text>
          </View>
        ) : null}

        {imageUri && step !== 'pick' ? (
          <Image
            source={{ uri: imageUri }}
            resizeMode="contain"
            className="h-44 w-full rounded-2xl border border-neutral-200 dark:border-neutral-800"
          />
        ) : null}

        {step === 'pick' ? (
          <View className="gap-3">
            <Pressable
              onPress={() => pick('camera')}
              className="h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-primary active:opacity-80">
              <Ionicons name="camera" size={20} color="#fff" />
              <Text className="text-base font-bold text-white">명함 촬영</Text>
            </Pressable>
            <Pressable
              onPress={() => pick('library')}
              className="h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-primary-light active:opacity-70">
              <Ionicons name="images" size={20} color={PRIMARY} />
              <Text className="text-base font-bold text-primary">앨범에서 선택</Text>
            </Pressable>
            <Text className="mt-1 text-center text-xs text-neutral-400">
              촬영한 명함은 AI가 자동으로 인식해 담당자 정보로 정리합니다.
            </Text>
          </View>
        ) : null}

        {step === 'parsing' ? (
          <View className="flex-row items-center justify-center gap-2 py-8">
            <ActivityIndicator color={PRIMARY} />
            <Text className="text-sm text-neutral-500">명함을 인식하는 중…</Text>
          </View>
        ) : null}

        {step === 'form' || step === 'saving' ? (
          <View className="gap-3">
            {/* 사업장 선택 */}
            <View className="rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
              <Text className="mb-2 text-xs font-bold text-neutral-500">사업장 선택 *</Text>
              {facility ? (
                <View className="flex-row items-center gap-2 rounded-xl bg-primary-light px-3 py-2.5">
                  <Ionicons name="checkmark-circle" size={18} color={PRIMARY} />
                  <View className="flex-1">
                    <Text className="text-sm font-bold text-neutral-900 dark:text-neutral-900">
                      {facility.companyName}
                    </Text>
                    {facility.siteAddress ? (
                      <Text className="text-xs text-neutral-500">{facility.siteAddress}</Text>
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
                      className="flex-1 rounded-xl border border-neutral-300 px-3 py-2 text-base text-neutral-900 dark:border-neutral-700 dark:text-white"
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
                      className="rounded-xl border border-neutral-200 px-3 py-2 active:opacity-70 dark:border-neutral-700">
                      <Text className="text-sm font-bold text-neutral-900 dark:text-white">
                        {f.companyName}
                      </Text>
                      <Text className="text-xs text-neutral-500">{f.siteAddress ?? '—'}</Text>
                    </Pressable>
                  ))}
                  {quickOpen ? (
                    <View className="mt-1 gap-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-700">
                      <Text className="text-xs font-bold text-neutral-700 dark:text-neutral-200">
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
            <View className="gap-2 rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
              <Text className="text-xs font-bold text-neutral-500">담당자 정보</Text>
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
                className="items-center justify-center rounded-xl border border-neutral-300 px-4 py-3 active:opacity-70 dark:border-neutral-700">
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
          <View className="items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
            <View className="rounded-full bg-green-100 p-3 dark:bg-green-900">
              <Ionicons name="checkmark" size={28} color="#16a34a" />
            </View>
            <Text className="text-center text-sm font-bold text-neutral-900 dark:text-white">
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
                className="rounded-xl border border-neutral-300 px-4 py-2.5 active:opacity-70 dark:border-neutral-700">
                <Text className="font-semibold text-neutral-700 dark:text-neutral-200">완료</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>
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
      <Text className="w-16 text-xs text-neutral-400">{label}</Text>
      <TextInput
        className="flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-base text-neutral-900 dark:border-neutral-700 dark:text-white"
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
      <Text className="w-16 text-xs text-neutral-400">{label}</Text>
      <TextInput
        className="flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:text-white"
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
      />
    </View>
  );
}
