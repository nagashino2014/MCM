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

`CdashRoot` renders `<div class="cdash cd-canvas cd-shell cd-fields-white" data-theme>` — the same root the app shell uses. In light theme the canvas is a soft cool-gray→beige gradient with two faint blurred light spots (dark theme: flat). Font: Pretendard Variable (shipped in `fonts/`). Modals/drawers/toasts portal to `body` and style themselves with `cdash-vars`.

## 2. Styling vocabulary (use these names; do not invent classes)

| Purpose | Classes |
|---|---|
| Surfaces | `cd-card` (opaque white card, faint 1px border, one soft shadow `--cd-shadow`; a card inside a card or modal has no shadow), `cd-card-title`, `cd-inset`, `cd-surface-bg`, `cd-divider`, `cd-listitem` (+ `data-active="true"`) |
| Text | `cd-text`, `cd-text-muted`, `cd-text-faint`, `cd-text-primary`, `cd-success-text`, `cd-warn-text`, `cd-error-text` |
| Buttons (raw) | `cd-btn` + one of `cd-btn-primary` (solid indigo `#4a63d8` with a 1px darker edge — the main action, one per work surface) / `cd-btn-ghost` / `cd-btn-soft` / `cd-btn-danger`; `cd-btn-sm`; `cd-icon-button` |
| Fields (raw) | `cd-input`, `cd-select`, `cd-textarea`, `cd-label` |
| Tables | `cd-table` (white surface; header row uses `--cd-table-header-bg`), `cd-table-section` (12px gap above a table). Never place a table directly on the app canvas — put it in a white card |
| Tags & choices | `cd-pill` + `cd-pill-info` / `cd-pill-success` …, `cd-chip`, `cd-choice` with `data-active="true"` (light primary-tint selected state) |
| Shell chrome only | `cd-glass` (sidebar) / `cd-glass-bar` (top bar): translucent white + backdrop blur. Never on content cards, tables, fields or modals |
| Tabs | `cd-tabs` / `cd-tab` — always through the `CdTabs` component (see the tab rule below) |
| Misc | `cd-border-c` (neutral border color), `cd-row-hover`, `cd-tint-primary` |

Tokens for inline styles: `var(--cd-bg)`, `--cd-card`, `--cd-surface`, `--cd-border`, `--cd-text`, `--cd-muted`, `--cd-faint`, `--cd-primary`, `--cd-primary-soft`, `--cd-primary-fill`, `--cd-success`, `--cd-warning`, `--cd-error`, `--cd-shadow`, `--cd-card-border`, `--cd-tab-selected`, `--cd-radius-card`, `--cd-radius-control` (both 10px). Type sizes: `--precision-ui-font-title` (22px), `-section` (16px), `-body` (14px), `-table` (12px), `-meta` (11px); control height `--precision-ui-control-height` (36px).

**Tab rule — page tabs are segmented, filters are pills.** Any control that swaps the whole content of a page, panel or modal (e.g. 전자결재 / 발송공문 / 발송견적, 결재 대기 / 진행 중 / 완료) is a page tab: render it with `<CdTabs>` using the default `variant="segment"` — a white box (card surface, faint border, soft shadow, radius 10) holding the tabs; the selected tab is a light indigo tint (`--cd-tab-selected`, #EEF1FB) with deep indigo text (#2F41A8), no border. Section tabs attached to a card header that swap that card's body may use `variant="underline"` (primary text + 2px bar). Never build page tabs from folder-style buttons, filled buttons or chips. `variant="pill"` is only for filters that narrow the same list inside a card (period, status, kind); a pill filter row sits below the page tabs, never in their place.

**Placement rule — the canvas is spacing, not a surface.** Never place loose content directly on the app canvas: badges/tags, avatars, counts, checkboxes, icon buttons, form fields, tables and text blocks always sit inside a white card (`<div className="cd-card p-4">…</div>`). Only the page header (`CdPageHeader`), segmented page tabs (they are their own white box) and the gaps between cards show the canvas.

Rules: opaque surfaces with faint 1px borders; radius 10px for cards, buttons, fields and tabs (`rounded-lg` = 10px; pills/avatars `rounded-full`); shadows only through `cd-card`/`--cd-shadow` and overlay tokens (no `shadow-*` utilities); blur only in shell chrome; gradients only on the shell canvas. Generous spacing: 20px between sections, 16px card padding. Status = semantic color + text (never color alone). Numbers right-aligned in tables. Layout glue with Tailwind utilities (`flex`, `grid`, `gap-3`, `min-w-0`, …) is fine; colors and radii come from cdash classes/tokens, not arbitrary hex.

## 3. Prefer components over raw classes

`CdPageHeader` (title, `help` → `?` popover, `meta`, `actions`, `tabs`), `CdButton` / `CdIconButton`, `CdInput` / `CdSelect` / `CdTextarea` / `CdCheckbox` (built-in `label`, `required`, `hint`, `error`), `CdDateInput` (text entry, `YYYYMMDD` → `YYYY-MM-DD`; never use native `type="date"`), `CdTable` (column defs, sort, selection, loading, empty; renders inside its own white card by default — pass `bare` only when it already sits inside a `cd-card`), `CdTabs` (default `segment` for every page/modal tab; `underline` for card-header section tabs; `pill` only for in-card list filters), `CdBadge` / `CdCount`, `CdModal` / `CdDrawer`, `CdDropdown`, `CdToastProvider` + `useCdToast`, `CdEmptyState`, `CdHelp`, `CdAvatar`, `CdSplitPane`. Read each component's `.d.ts` and `.prompt.md` before use.

## 4. Where the truth lives

`styles.css` → `_ds_bundle.css` holds the compiled cdash + app stylesheet (all class and token definitions above). Page layout conventions: sidebar 248px (rail 76px, frosted glass, only the current menu group expanded) and a frosted top bar are outside your canvas; content area at 1920×1080 is ~1624px wide. Split screens use a list pane + detail pane; size the list pane with `clamp()` rather than a fixed px width, and let inner forms wrap by their own width (`flex flex-wrap` with min widths), because viewport breakpoints do not reflect the pane width.

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
