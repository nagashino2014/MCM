/**
 * IMAP 폴더 이름용 변형 UTF-7(RFC 3501 §5.1.3). 한글 폴더 이름(보낸편지함 등)을 이 형식으로 주고받는다.
 * 인쇄 가능 ASCII(0x20~0x7e)는 그대로, '&' 는 "&-", 나머지는 UTF-16BE 를 ',' 쓰는 base64 로 "&...-" 에 담는다.
 */

export function encodeMutf7(s: string): string {
  let out = "";
  let pending: number[] = [];
  const flush = () => {
    if (!pending.length) return;
    const bytes = Buffer.alloc(pending.length * 2);
    pending.forEach((u, i) => bytes.writeUInt16BE(u, i * 2));
    out += "&" + bytes.toString("base64").replace(/=+$/, "").replace(/\//g, ",") + "-";
    pending = [];
  };
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0x20 && code <= 0x7e) {
      flush();
      out += code === 0x26 ? "&-" : s[i];
    } else {
      pending.push(code);
    }
  }
  flush();
  return out;
}

export function decodeMutf7(s: string): string {
  return s.replace(/&([^-]*)-/g, (_all, b64: string) => {
    if (b64 === "") return "&";
    const bytes = Buffer.from(b64.replace(/,/g, "/"), "base64");
    let out = "";
    for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode(bytes.readUInt16BE(i));
    return out;
  });
}
