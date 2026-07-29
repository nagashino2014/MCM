"use client";

// cdash 공통 아바타 — 이름 이니셜(한글은 성명 첫 글자) + 결정적 파스텔 배경(G0).
// 이미지 src 지정 시 이미지, 아니면 이니셜. 휴가관리 아바타 관례(이름 기반 색상)를 표준화.

import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type CdAvatarSize = "xs" | "sm" | "md" | "lg";

const SIZE_CLASS: Record<CdAvatarSize, string> = {
  xs: "w-6 h-6 text-[10px]",
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-14 h-14 text-lg",
};

// 아바타 전용 저채도 팔레트 — 상태색(성공·경고·위험)과 색조를 분리해 의미 혼선을 없앤다.
// 배경은 같은 색의 알파 틴트(color-mix), 글자는 원색.
const PALETTE = ["--cd-av-1", "--cd-av-2", "--cd-av-3", "--cd-av-4", "--cd-av-5", "--cd-av-6"];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** 표시 이니셜 — 한글이면 첫 글자, 영문이면 단어 첫 글자 2개. */
function initials(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  if (/[가-힣]/.test(t[0])) return t[0];
  const words = t.split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export interface CdAvatarProps extends HTMLAttributes<HTMLSpanElement> {
  name: string;
  src?: string | null;
  size?: CdAvatarSize;
}

export function CdAvatar({ name, src, size = "md", className, ...rest }: CdAvatarProps) {
  const token = PALETTE[hashName(name || "?") % PALETTE.length];
  const color = {
    bg: `color-mix(in srgb, var(${token}) 18%, transparent)`,
    fg: `var(${token})`,
  };
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full font-bold shrink-0 select-none overflow-hidden",
        SIZE_CLASS[size],
        className
      )}
      style={src ? undefined : { background: color.bg, color: color.fg }}
      title={name}
      {...rest}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="w-full h-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}
