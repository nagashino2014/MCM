"use client";

// 메일 본문 머리글의 주소 한 개(2026-11-12, 직원 요청 20) — 누르거나 우클릭하면 주소 메뉴(메일 쓰기·주소록 추가·복사 등)를 연다.
// 받은·보낸 메일 모두 보낸사람·받는사람·참조에 쓴다. onOpen 이 없으면 글자만 그린다.

import type { MouseEvent, KeyboardEvent } from "react";

/** "이름 <주소>" → { name, address }. 주소만 있으면 name=null. */
export function splitMailAddress(raw: string): { name: string | null; address: string } {
  const m = raw.trim().match(/^(.*?)\s*<([^>]+)>$/);
  if (m) return { name: m[1].replace(/^"|"$/g, "").trim() || null, address: m[2].trim() };
  return { name: null, address: raw.trim() };
}

export function MailAddressLink({
  address,
  name,
  label,
  onOpen,
}: {
  address: string;
  name?: string | null;
  /** 표시 글자(기본: 주소). */
  label?: string;
  onOpen?: (address: string, name: string | null, rect: DOMRect) => void;
}) {
  const text = label ?? address;
  if (!onOpen) return <>{text}</>;
  const open = (e: MouseEvent<HTMLSpanElement> | KeyboardEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onOpen(address, name ?? null, e.currentTarget.getBoundingClientRect());
  };
  return (
    <span
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      title={`${address} — 눌러서 메뉴 열기(주소록 추가 등)`}
      onClick={open}
      onContextMenu={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") open(e);
      }}
      className="cursor-pointer hover:underline underline-offset-2 focus-visible:underline"
    >
      {text}
    </span>
  );
}
