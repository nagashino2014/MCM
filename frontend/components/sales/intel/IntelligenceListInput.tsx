"use client";
import { useEffect, useState } from "react";
import { CdInput } from "@/components/cdash";
import { commaValues } from "./intelligence-client";

/** 쉼표를 입력하는 중에는 원문을 유지하고 포커스를 옮길 때 목록을 정규화한다. */
export function IntelligenceListInput({ label, value, onChange, placeholder }: { label: string; value: string[]; onChange: (values: string[]) => void; placeholder?: string }) {
  const joined = value.join(", ");
  const [text, setText] = useState(joined);
  useEffect(() => { setText(joined); }, [joined]);
  return <CdInput label={label} value={text} placeholder={placeholder} onChange={(event) => setText(event.target.value)} onBlur={() => onChange(commaValues(text))} />;
}
