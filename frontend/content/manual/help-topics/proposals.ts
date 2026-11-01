import type { HelpTopic } from "../types";

export const PROPOSAL_HELP: HelpTopic[] = [{
  id: "sales.proposals", label: "용역 제안서 도움말",
  blocks: [{ kind: "list", items: [
    "미리보기에서 블록을 누르면 오른쪽에 속성이 열리고, 글을 더블클릭하면 그 자리에서 고칩니다.",
    "쪽 제목을 누르면 쪽 설정과 블록 추가가 열립니다. 모양 바꾸기로 개조식·카드·단계·표를 서로 바꿉니다.",
    "주황 점은 쪽 넘침입니다. [다음 쪽으로 넘기기]로 정리한 뒤 HWPX 를 발행하세요.",
    "상단의 '작성 필요' 칩은 발행 전에 채울 칸 목록입니다. 찾기·바꾸기(Ctrl+H)로 같은 말을 한 번에 바꿉니다.",
    "AI로 고치기는 블록·쪽의 글만 고친 제안을 보여 줍니다. 노란 검토 표시(근거 없는 숫자 등)를 확인하고 고른 곳만 채택하세요.",
  ] }],
  more: { article: "sales.proposals", section: "edit" },
  sources: ["components/sales/proposal/ProposalStudio.tsx", "components/sales/proposal/ProposalAiPanel.tsx"], reviewedAt: "2026-11-01",
}];
