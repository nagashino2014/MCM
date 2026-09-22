// 내부고시·내부 규정 PDF·HWPX 내려받기(클라이언트) — POST 로 렌더한 파일을 받아 저장 대화상자를 띄운다.
// 파일 이름은 서버의 Content-Disposition(filename*=UTF-8'') 을 따른다.

export async function downloadExport(url: string, payload: unknown, fallbackName: string): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string })?.error ?? "파일을 만들지 못했습니다.");
  }
  const cd = res.headers.get("Content-Disposition") ?? "";
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const blobUrl = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}
