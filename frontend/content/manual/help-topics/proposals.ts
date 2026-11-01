import type { HelpTopic } from "../types";

export const PROPOSAL_HELP: HelpTopic[] = [{
  id: "sales.proposals", label: "용역 제안서 도움말",
  blocks: [{ kind: "list", items: [
    "미리보기에서 블록을 누르면 오른쪽에 속성이 열리고, 글을 더블클릭하면 그 자리에서 고칩니다.",
    "쪽 제목을 누르면 쪽 설정과 블록 추가가 열립니다. 모양 바꾸기로 개조식·카드·단계·표를 서로 바꿉니다.",
    "주황 점은 쪽 넘침입니다. [다음 쪽으로 넘기기]로 정리한 뒤 HWPX 를 발행하세요.",
  ] }],
  more: { article: "sales.proposals", section: "edit" },
  sources: ["components/sales/proposal/ProposalStudio.tsx"], reviewedAt: "2026-10-31",
}];
