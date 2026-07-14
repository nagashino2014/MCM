"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, MapPin, Phone, Search, Smartphone } from "lucide-react";
import { Empty, ErrorBox, Loading, MobileSheet, SheetRow } from "./mobile-shared";

// 모바일 사업장 — 서버 검색(/api/facilities?q=) → 카드 리스트 → 요약 시트.
// 상세 요약은 리스트 아이템 필드 + 담당자(/api/facilities/[id]/contacts)로 구성 — 별도 detail API 불필요.

interface FacilityItem {
  facilityId: string;
  companyName: string;
  siteAddress: string | null;
  phoneNumber: string | null;
  industryName: string | null;
  representativeName: string | null;
  airClass: number | null;
  waterClass: number | null;
}

interface ContactPerson {
  id: number;
  personName: string;
  title: string | null;
  departmentName?: string | null;
  officePhone: string | null;
  mobilePhone: string | null;
  email: string | null;
  status: string;
}

export function MobileFacilities() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<FacilityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FacilityItem | null>(null);

  const search = useCallback(async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "30", sort: "name" });
      if (query.trim()) params.set("q", query.trim());
      const res = await fetch(`/api/facilities?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    search("");
  }, [search]);

  return (
    <div className="flex flex-col gap-3">
      {/* 검색 */}
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search(q);
        }}
      >
        <input
          className="cd-input flex-1"
          style={{ height: 42 }}
          placeholder="사업장명·주소 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" className="cd-btn cd-btn-primary shrink-0" style={{ height: 42 }} aria-label="검색">
          <Search className="w-4 h-4" />
        </button>
      </form>

      {error && <ErrorBox message={error} />}

      {loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty label="검색 결과가 없습니다." />
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((f) => (
            <button
              key={f.facilityId}
              className="cd-card-bg border cd-border-c rounded-2xl px-3.5 py-3 flex items-center gap-2.5 text-left"
              onClick={() => setSelected(f)}
            >
              <div className="flex-1 min-w-0">
                <div className="cd-text text-sm font-bold truncate">{f.companyName}</div>
                <div className="cd-text-faint text-xs truncate">
                  {[f.siteAddress, f.industryName].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
              <ClassPills air={f.airClass} water={f.waterClass} />
              <ChevronRight className="w-4 h-4 cd-text-faint shrink-0" />
            </button>
          ))}
        </div>
      )}

      {selected && <FacilitySheet facility={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function ClassPills({ air, water }: { air: number | null; water: number | null }) {
  if (air == null && water == null) return null;
  return (
    <span className="flex flex-col gap-0.5 shrink-0">
      {air != null && <span className="cd-pill cd-pill-info text-[10px]">대기 {air}종</span>}
      {water != null && <span className="cd-pill cd-pill-secondary text-[10px]">수질 {water}종</span>}
    </span>
  );
}

function FacilitySheet({ facility: f, onClose }: { facility: FacilityItem; onClose: () => void }) {
  const [people, setPeople] = useState<ContactPerson[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/facilities/${encodeURIComponent(f.facilityId)}/contacts`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setPeople(
            (Array.isArray(data.people) ? (data.people as ContactPerson[]) : []).filter((p) => p.status !== "inactive")
          );
        }
      } finally {
        setPeopleLoading(false);
      }
    })();
  }, [f.facilityId]);

  const mapUrl = f.siteAddress ? `https://map.naver.com/p/search/${encodeURIComponent(f.siteAddress)}` : null;

  return (
    <MobileSheet title={f.companyName} onClose={onClose}>
      <div className="rounded-xl border cd-border-c px-3 py-1.5">
        <SheetRow
          label="주소"
          value={
            f.siteAddress ? (
              <span className="inline-flex items-start gap-1.5">
                <span>{f.siteAddress}</span>
                {mapUrl && (
                  <a href={mapUrl} target="_blank" rel="noreferrer" className="cd-text-primary shrink-0" aria-label="지도앱 열기">
                    <MapPin className="w-4 h-4" />
                  </a>
                )}
              </span>
            ) : (
              "—"
            )
          }
        />
        <SheetRow
          label="대표번호"
          value={f.phoneNumber ? <a href={`tel:${f.phoneNumber}`} className="cd-text-primary font-bold">{f.phoneNumber}</a> : "—"}
        />
        <SheetRow label="대표자" value={f.representativeName ?? "—"} />
        <SheetRow label="업종" value={f.industryName ?? "—"} />
        <SheetRow
          label="종규모"
          value={
            f.airClass == null && f.waterClass == null
              ? "—"
              : [f.airClass != null ? `대기 ${f.airClass}종` : null, f.waterClass != null ? `수질 ${f.waterClass}종` : null]
                  .filter(Boolean)
                  .join(" · ")
          }
        />
      </div>

      <h4 className="cd-text-muted text-xs font-bold mt-4 mb-1.5 px-1">담당자</h4>
      {peopleLoading ? (
        <Loading />
      ) : people.length === 0 ? (
        <Empty label="등록된 담당자가 없습니다." />
      ) : (
        <div className="flex flex-col gap-2">
          {people.map((p) => (
            <div key={p.id} className="rounded-xl border cd-border-c px-3 py-2.5 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="cd-text text-sm font-bold truncate">
                  {p.personName}
                  {p.title && <span className="cd-text-muted font-normal ml-1.5 text-xs">{p.title}</span>}
                </div>
                <div className="cd-text-faint text-xs truncate">{p.mobilePhone ?? p.officePhone ?? p.email ?? "—"}</div>
              </div>
              {(p.mobilePhone ?? p.officePhone) && (
                <a
                  href={`tel:${p.mobilePhone ?? p.officePhone}`}
                  className="cd-btn cd-btn-soft cd-btn-sm shrink-0"
                  aria-label="전화"
                >
                  <Phone className="w-4 h-4" />
                </a>
              )}
              {p.mobilePhone && (
                <a href={`sms:${p.mobilePhone}`} className="cd-btn cd-btn-soft cd-btn-sm shrink-0" aria-label="문자">
                  <Smartphone className="w-4 h-4" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </MobileSheet>
  );
}
