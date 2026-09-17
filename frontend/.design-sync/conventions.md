# MCM cdash — conventions for building screens

MCM is a Korean-language internal groupware app (contracts, e-approval, payroll, work reports). UI text is Korean. Styling is **class-based**: cdash CSS classes + `--cd-*` CSS variables, with Tailwind utilities for layout glue.

## 1. Always wrap in `CdashRoot`

All `--cd-*` tokens are defined only under `.cdash` / `.cdash-vars`. Without the root wrapper every component renders unstyled (no colors, borders, radii).

```jsx
const { CdashRoot, CdPageHeader, CdButton } = window.MCMCdash;

<CdashRoot theme="light">{/* "dark" also supported */}
  <CdPageHeader title="결재 문서함" actions={<CdButton variant="primary">새 기안</CdButton>} />
</CdashRoot>
```

`CdashRoot` renders `<div class="cdash cd-canvas cd-fields-white" data-theme>` — the same root the app shell uses (beige app background in light theme). Modals/drawers/toasts portal to `body` and style themselves with `cdash-vars`.

## 2. Styling vocabulary (use these names; do not invent classes)

| Purpose | Classes |
|---|---|
| Surfaces | `cd-card` (opaque card, 1px border, no shadow), `cd-card-title`, `cd-inset`, `cd-surface-bg`, `cd-divider`, `cd-listitem` (+ `data-active="true"`) |
| Text | `cd-text`, `cd-text-muted`, `cd-text-faint`, `cd-text-primary`, `cd-success-text`, `cd-warn-text`, `cd-error-text` |
| Buttons (raw) | `cd-btn` + one of `cd-btn-primary` (blue→violet gradient, the main action) / `cd-btn-ghost` / `cd-btn-soft` / `cd-btn-danger`; `cd-btn-sm`; `cd-icon-button` |
| Fields (raw) | `cd-input`, `cd-select`, `cd-textarea`, `cd-label` |
| Tables | `cd-table` (white surface; header row uses `--cd-table-header-bg`), `cd-table-section` (12px gap above a table). Never place a table directly on the beige app background — put it in a white card |
| Tags & choices | `cd-pill` + `cd-pill-info` / `cd-pill-success` …, `cd-chip`, `cd-choice` with `data-active="true"` (light gradient selected state) |
| Tabs | `cd-tabs` / `cd-tab` — always through the `CdTabs` component (see the tab rule below) |
| Misc | `cd-border-c` (neutral border color), `cd-row-hover`, `cd-tint-primary` |

Tokens for inline styles: `var(--cd-bg)`, `--cd-card`, `--cd-surface`, `--cd-border`, `--cd-text`, `--cd-muted`, `--cd-faint`, `--cd-primary`, `--cd-primary-soft`, `--cd-success`, `--cd-warning`, `--cd-error`, `--cd-radius-card`, `--cd-radius-control`, `--cd-action-background`. Type sizes: `--precision-ui-font-title` (22px), `-section` (16px), `-body` (14px), `-table` (12px), `-meta` (11px); control height `--precision-ui-control-height` (36px).

**Tab rule — page tabs are underline, filters are pills.** Any control that swaps the whole content of a page, card, panel or modal (e.g. 전자결재 / 발송공문 / 발송견적, 용역 / Task, 기본 정보 / 학력 / 인사관리) is a page tab: render it with `<CdTabs>` using the default `variant="underline"` (selected = primary text + 2px bar, no box). Never build page tabs from folder-style buttons, filled segmented buttons or chips. `variant="pill"` is only for filters that narrow the same list inside a card (period, status, kind); a pill filter row sits below the page tabs, never in their place.

**Placement rule — beige is spacing, not a surface.** The light-theme app background is beige. Never place content directly on it: badges/tags, avatars, counts, checkboxes, icon buttons, tabs, form fields, tables and text blocks always sit inside a white card (`<div className="cd-card p-4">…</div>`). Only the page header (`CdPageHeader`) and the gaps between cards show the beige background.

Rules: opaque surfaces, 1px neutral borders, no card shadows/blur/background gradients. Status = semantic color + text (never color alone). Numbers right-aligned in tables. Layout glue with Tailwind utilities (`flex`, `grid`, `gap-3`, `min-w-0`, …) is fine; colors and radii come from cdash classes/tokens, not arbitrary hex.

## 3. Prefer components over raw classes

`CdPageHeader` (title, `help` → `?` popover, `meta`, `actions`, `tabs`), `CdButton` / `CdIconButton`, `CdInput` / `CdSelect` / `CdTextarea` / `CdCheckbox` (built-in `label`, `required`, `hint`, `error`), `CdDateInput` (text entry, `YYYYMMDD` → `YYYY-MM-DD`; never use native `type="date"`), `CdTable` (column defs, sort, selection, loading, empty; renders inside its own white card by default — pass `bare` only when it already sits inside a `cd-card`), `CdTabs` (default `underline` for every page/section/modal tab; `pill` only for in-card list filters), `CdBadge` / `CdCount`, `CdModal` / `CdDrawer`, `CdDropdown`, `CdToastProvider` + `useCdToast`, `CdEmptyState`, `CdHelp`, `CdAvatar`, `CdSplitPane`. Read each component's `.d.ts` and `.prompt.md` before use.

## 4. Where the truth lives

`styles.css` → `_ds_bundle.css` holds the compiled cdash + app stylesheet (all class and token definitions above). Page layout conventions: sidebar 248px (rail 76px) is outside your canvas; content area at 1920×1080 is ~1624px wide. Split screens use a list pane + detail pane; size the list pane with `clamp()` rather than a fixed px width, and let inner forms wrap by their own width (`flex flex-wrap` with min widths), because viewport breakpoints do not reflect the pane width.

## 5. Example

```jsx
<CdashRoot>
  <div className="flex flex-col gap-5 p-5">
    <CdPageHeader title="계약 관리" meta="진행 12건" help="계약을 선택하면 우측에 상세가 열립니다."
      actions={<CdButton variant="primary">새 계약 등록</CdButton>} />
    <section className="cd-card p-4">
      <div className="cd-card-title">진행 중 계약</div>
      <CdTable bare className="cd-table-section" columns={columns} rows={rows} rowKey={(r) => r.id} />
    </section>
  </div>
</CdashRoot>
```
