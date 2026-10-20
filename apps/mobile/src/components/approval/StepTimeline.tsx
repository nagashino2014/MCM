import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/useTheme';

export interface Step {
  stepId: string;
  stepOrder: number;
  stepType: string;
  assigneeUserId: string;
  assigneeName: string | null;
  assigneePosition: string | null;
  status: string;
  actedAt: string | null;
  comment: string | null;
  delegatedFrom: string | null;
  /** 대결 원결재자 이름·처리 유형·생략 사유(서버 301, 웹 DA-2·DA-3 표기와 동일 규칙) */
  delegatedFromName?: string | null;
  actType?: string | null;
  skipReason?: string | null;
}

const STEP_TYPE_LABEL: Record<string, string> = {
  approve: '결재',
  agree: '합의',
  reference: '참조',
};

function icon(status: string): { name: keyof typeof Ionicons.glyphMap; tone: 'success' | 'error' | 'primary' | 'faint' } {
  switch (status) {
    case 'approved':
      return { name: 'checkmark-circle', tone: 'success' };
    case 'rejected':
      return { name: 'close-circle', tone: 'error' };
    case 'pending':
      return { name: 'ellipse-outline', tone: 'primary' };
    case 'skipped':
      return { name: 'remove-circle-outline', tone: 'faint' };
    default:
      return { name: 'ellipse-outline', tone: 'faint' };
  }
}

/** 대결·부재·전결 표기 — 웹 lib/approval/step-display.ts 와 같은 문구. */
function stepNote(s: Step): { text: string; tone: 'warning' | 'primary' | 'faint' } | null {
  if (s.delegatedFrom) {
    const who = s.delegatedFromName ?? '원결재자';
    return { text: s.status === 'pending' ? `${who} 대결 대기` : `${who} 대결 처리`, tone: 'warning' };
  }
  if (s.status === 'approved' && s.actType === 'final') return { text: '전결', tone: 'primary' };
  if (s.status === 'skipped' && s.skipReason === 'absence') return { text: '부재 — 다음 결재자로 넘어감', tone: 'faint' };
  if (s.status === 'skipped' && s.skipReason === 'final') return { text: '전결로 생략', tone: 'faint' };
  return null;
}

const short = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 결재선 진행 상태 — 세로 타임라인(웹의 가로 결재선 칩을 모바일에 맞게 재배치). */
export function StepTimeline({ steps }: { steps: Step[] }) {
  const { c } = useTheme();
  const color = { success: c.success, error: c.error, primary: c.primary, faint: c.faint };

  return (
    <View className="gap-0">
      {steps.map((s, i) => {
        const ic = icon(s.status);
        const note = stepNote(s);
        const last = i === steps.length - 1;
        return (
          <View key={s.stepId} className="flex-row gap-2.5">
            {/* 아이콘 + 연결선 */}
            <View className="items-center">
              <Ionicons name={ic.name} size={18} color={color[ic.tone]} />
              {!last ? <View className="w-px flex-1 bg-cd-border" style={{ minHeight: 18 }} /> : null}
            </View>

            <View className={`flex-1 ${last ? '' : 'pb-3'}`}>
              <View className="flex-row items-center gap-1.5">
                <Text className="text-[14px] font-bold text-cd-text">
                  {s.assigneeName ?? '-'}
                </Text>
                {s.assigneePosition ? (
                  <Text className="text-[12px] text-cd-faint">{s.assigneePosition}</Text>
                ) : null}
                <View className="flex-1" />
                <Text className="text-[11px] text-cd-faint">
                  {STEP_TYPE_LABEL[s.stepType] ?? s.stepType}
                  {s.actedAt ? ` · ${short(s.actedAt)}` : ''}
                </Text>
              </View>

              {note ? (
                <Text
                  className={`text-[11px] ${
                    note.tone === 'warning' ? 'text-cd-warning' : note.tone === 'primary' ? 'text-cd-primary' : 'text-cd-faint'
                  }`}
                >
                  {note.text}
                </Text>
              ) : null}

              {s.comment ? (
                <View className="mt-1 rounded-xl bg-cd-surface px-3 py-2">
                  <Text className="text-[13px] leading-5 text-cd-muted">{s.comment}</Text>
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
