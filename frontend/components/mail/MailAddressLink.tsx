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

/** 머리글 주소 태그에 붙일 주소록 이름표(lib/mail/address-book MailAddressBookEntry 와 같은 모양). */
export interface MailAddressTagEntry {
  name: string;
  title: string | null;
  org: string | null;
}

/**
 * 머리글 주소 태그(2026-11-12 사용자 요청) — 보낸사람·받는사람·참조를 알약 모양으로 하나씩 보인다.
 * 앱 주소록에 등록된 사람이면 "성명 직함"을 앞에, 주소를 옅게 뒤에 둔다. 등록되지 않은 주소는 주소만.
 * 누르거나 우클릭하면 MailAddressLink 와 같은 주소 메뉴(주소록 추가 등)를 연다.
 */
export function MailAddressTag({
  address,
  entry,
  onOpen,
}: {
  address: string;
  entry?: MailAddressTagEntry | null;
  onOpen?: (address: string, name: string | null, rect: DOMRect) => void;
}) {
  const label = entry ? [entry.name, entry.title].filter(Boolean).join(" ") : null;
  const tip = [label, entry?.org, address].filter(Boolean).join(" · ");
  const open = (e: MouseEvent<HTMLSpanElement> | KeyboardEvent<HTMLSpanElement>) => {
    if (!onOpen) return;
    e.preventDefault();
    e.stopPropagation();
    onOpen(address, entry?.name ?? null, e.currentTarget.getBoundingClientRect());
  };
  return (
    <span
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-haspopup={onOpen ? "dialog" : undefined}
      title={onOpen ? `${tip} — 눌러서 메뉴 열기(주소록 추가 등)` : tip}
      onClick={open}
      onContextMenu={onOpen ? open : undefined}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") open(e);
      }}
      className={
        "inline-flex max-w-full items-center gap-1 rounded-[10px] border px-2 py-0.5 text-xs leading-5 " +
        (entry
          ? "border-[color:color-mix(in_srgb,var(--cd-primary)_22%,transparent)] bg-[color:var(--cd-primary-soft)] "
          : "cd-border-c bg-[color:var(--cd-surface)] ") +
        (onOpen ? "cursor-pointer hover:border-[color:var(--cd-primary)] focus-visible:outline-none focus-visible:border-[color:var(--cd-primary)]" : "")
      }
    >
      {label ? (
        <>
          <span className="font-semibold cd-text shrink-0">{label}</span>
          <span className="cd-text-faint truncate">&lt;{address}&gt;</span>
        </>
      ) : (
        <span className="cd-text truncate">{address}</span>
      )}
    </span>
  );
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
