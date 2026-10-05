# Handoff: Multi-Tool Workspace (URL Shortener + UTM Builder + Invoices + Settings)

## Overview

An internal multi-tool workspace for a small team. Four modules share one sidebar shell:

1. **URL Shortener** — create, edit, browse short links; sub-tab for Analytics. Default primary domain: `4th.link`.
2. **UTM Builder** — build tagged campaign URLs with a live URL preview, QR code, and folders.
3. **Invoice Generator** — full invoice lifecycle: **Draft → Sent → Overdue → Partially paid → Paid → Cancelled**. Payment logging, receipt mode, PDF export, dedicated analytics dashboard (Overview / Payments / Clients).
4. **Settings** — General, URL Shortener, UTM Builder, Invoice. Floating Save bar with dirty-state detection.

Aesthetic: **Basecoat UI-inspired** (utility-first, high-density, monochrome) with layout patterns pulled from **dub.co**. Typography is **Inter**. Tag/status pills use faint accent colors; everything else is neutral black-and-white.

---

## About the Design Files

The files bundled in `prototype/` and `index.html` are **design references created in HTML/CSS/JS** — clickable prototypes showing intended look, layout, and behavior. **They are not production code to copy directly.**

The developer's task is to **recreate these designs in the target codebase's existing environment** (React, Vue, SvelteKit, etc.) using its established patterns, components, and libraries. If no environment exists yet, choose the framework that best fits the project's goals — recommended: **Next.js + Tailwind + shadcn/ui**, since Basecoat itself is a shadcn-flavored CSS system.

`index.html` is a design canvas that renders every screen as a scaled iframe for review — it is **not** a page to ship. The pages under `prototype/` are the actual screen references.

---

## Fidelity

**High-fidelity.** These mocks contain final colors, typography, spacing, radii, interactions, and content. Recreate them pixel-perfectly using the target codebase's existing UI library (or shadcn/ui + Basecoat's tokens if starting fresh). Exact hex values, spacing scale, and radii are enumerated in the Design Tokens section below.

The **Analytics** pages carry placeholder/mock data derived from `SAMPLE_INVOICES` and hard-coded month-on-month distributions. Layouts, formulas (`computeTotals`), and chart types are production-intent; wire them to real queries at build time.

---

## Global Architecture

### Shell (`prototype/shell.js`)

- **Left sidebar (240px, sticky)**:
  - Workspace switcher (avatar + name + chevron)
  - Section label: "WORKSPACE"
  - Nav items (icon + label), each with optional sub-nav that expands when active:
    - **URL Shortener** — sub-nav: Links (default) · Analytics
    - **UTM Builder** — no sub-nav
    - **Invoice Generator** — sub-nav: Invoices (default) · Analytics
    - **Settings** — no sub-nav (its own settings-page sub-nav lives inside the page)
  - Footer: user row (avatar + name + email + ⋮)
- **Main area**: `background: white`, left border, `padding: 20px 28px 40px`, `max-width: 1280px` centered, scrollable.

### Active nav pattern

Active top-level and sub-nav items get a white pill background with a subtle border and shadow. Sub-nav items are indented 26px with a vertical hairline (`border-left: 1px solid var(--border)`) and include their own inline icon + label.

### Keyboard hint

Every primary "Create …" button carries a trailing `<kbd>C</kbd>` shortcut chip.

### The `computeTotals(inv)` contract (invoices)

**Single source of truth** for invoice totals. Called from the invoice canvas, the right rail, and every analytics query so numbers never disagree. Branches:

1. **`inv.items[]`** exists → sum line items, apply flat tax on top (`INVOICE_TAX_RATE = 0.075`).
2. **`inv.total` only** → back-solve one synthetic "Services rendered" line so the canvas still renders sensibly, and the grand equals what's stored.
3. **Neither** (fresh draft) → use default demo items.

Returns `{ items, subtotal, salesTax, grand, payments, paid, outstanding }`.

---

## Screens / Views

### URL Shortener

#### 1. Links — list view (`prototype/links.html`)

- **Page header**: `Links` title + total-count pill + `Create link` primary button (with `C` kbd hint).
- **List tabs**: `All Active <n>` (active — 2px black underline) · `Archived <n>`. Active tab's count pill is inverted (black bg, white text).
- **Toolbar** (10px vertical padding):
  - **Folder filter** (colored folder swatch + name + chevron)
  - `Filter ▾` outline button
  - `Sort ▾` outline button (arrow-up-down icon)
  - Flex spacer
  - Search input (280px, `Search by short link or URL`)
  - Trailing ⋯ overflow icon-only button
- **Link list** — one `.link-card` per link.
- **Pagination** — `Viewing 1–N of N links` on the left; `Previous` / `Next` on the right.

#### 2. Link card row

Grid: `32px  minmax(0,1fr)  auto  32px` → `favicon · info-block · meta-right · ⋮`. `min-height: 52px`, `--radius` corners, `1px solid --border` outline, `--muted-2` hover.

- **Favicon** — 28×28 circle, colored per brand (Google/Slack/Discord/dot-green/dot-red).
- **Info block**:
  - Row 1: `link-alias` (13px, 600) + hover copy icon
  - Row 2 (`link-dest`, 12px, muted): arrow SVG + `.link-dest-url` (truncated, max 46ch) + `.link-dest-meta` (16×16 creator avatar + date, separated by a left border)
- **Meta-right cluster**: optional tag pill + `⚡ N clicks` pill.
- **⋮** — 30×30 ghost icon button.

#### 3. Create Link modal (`prototype/create-link.html`)

Backdrop `rgba(0,0,0,0.4)` + 2px blur. `1120px` wide, `--radius-lg`, `--shadow-xl`. Body grid `1.55fr | 1fr`:
- **Left**: Destination URL · Short Link constructor (`4th.link ▾` + alias input + shuffle/wand) · Tags · Comments · Cloak link toggle.
- **Right** (`--muted-2` bg): Folder picker · QR Code card (120×120) · **Custom Link Preview** toggle row (default OFF) · OG preview with Web/X/LinkedIn/Facebook tab strip.
- **Footer**: Advanced settings bar (`⊕ UTM`, `🔒 Password`, `⏰ Expiration`) · `Create link` primary.

#### 4. Edit Link page (`prototype/edit-link.html`)

Full page. Crumb bar `Links › <favicon> 4th.link/fa-curriculum ▾` on the left; on the right: click-count pill · Copy link · ⋮. Body reuses the same left/right layout as Create. Bottom footer: `<avatar> Created by ndcharles · Aug 14`.

#### 5. Row action menu (`prototype/action-menu.html`)

Row highlighted (`--muted-2` bg, stronger border, shadow); dropdown positioned below-right of ⋮: **Edit · Duplicate · Archive · Delete** (destructive, `#dc2626`).

#### 6. Empty state (`prototype/links-empty.html`)

Same shell + tabs at 50% opacity. Full-width dashed card with 56×56 muted icon, "No links yet" heading, one-line description, primary Create button.

#### 7. Link Analytics (`prototype/analytics.html`)

Sub-nav Analytics active. **Illustrative data.** Header + `Filter / Last 30 days ▾ / Export`. 5-card KPI row: Clicks · Unique visitors · Active links · **Top referring channel** · Last click. Clicks-over-time chart card (SVG line + gradient fill; Day/Week/Month button group). Split row (3 cols): Top links · Top countries · Referrers (each with `Coming soon` chip). Devices & browsers full-width card with three columns (Device / Browser / Engine · OS).

---

### UTM Builder

#### 8. UTM Campaigns list (`prototype/utms.html`)

Structurally identical to Links list. Differences: title `UTM Builder`, folder filter says `Campaigns`, primary button is `Create campaign`, no sub-nav. Cards use `.link-card.utm-card` variant.

#### 9. UTM card

Grid: `32px | minmax(0,1fr) | auto | 32px`.
- Favicon: black square with a UTM slider glyph.
- Info block row 1: website URL (no scheme) + copy icon.
- Info block row 2: arrow + **full generated URL** + `.link-dest-meta` (avatar + date, divided by left border).
- Meta-right: **three color-coded pills** with a small square color dot — Source (blue), Medium (yellow), Content (green). Monospace font. Hover title reveals which is which. No text prefix.
- ⋮ trailing.

#### 10. UTM Create modal (`prototype/create-utm.html`)

Header identical to Create Link (breadcrumb + Draft saved + X). Body `.utm-layout` grid = `1fr | 320px`:

- **Left — form** (2-col grid, 14px vertical / 20px horizontal):
  - Website URL* (full-width)
  - Campaign source* · Campaign medium*
  - Campaign name · Campaign ID
  - Campaign term · Campaign content
  - Comments (full-width textarea, internal-only)

- **Right — preview column** (`--muted-2` bg, 20px padding):
  - **Folder** picker
  - **QR Code** card (64×64 thumbnail + short caption + `Customize` chip)
  - **Live preview** label + character count
  - **Preview card** — black bg, monospace, `min-height: 80px`, grows downward. Syntax highlighted (base URL white, keys `#93c5fd`, values `#fef3c7`, separators white @ 40%).

- **Footer**: required-field hint · `Create campaign` primary + `↵` kbd.

#### 11. UTM Edit (`prototype/edit-utm.html`)

Full page. Crumb bar (Copy URL + ⋮). Body identical to Create's `.utm-layout`, rendered inside a bordered rounded card. Creator note bar at the bottom.

#### 12. UTM Empty state / Action menu (`prototype/utms-empty.html`, `utm-action-menu.html`)

Analogous to Links. Menu items: Edit · Duplicate · **Copy URL** · Archive · Delete.

---

### Invoice Generator

#### 13. Invoices list (`prototype/invoices.html`)

- Page title `Invoices` + **How to Guide** button (opens the status guide modal — see #17) + primary `Create invoice` (with `C` kbd).
- **Status tabs**: `All invoices · Draft · Sent · Overdue · Partially paid · Paid · Cancelled`. Query-param backed (`?status=…`) so any tab is deep-linkable.
- Toolbar identical to Links (folder filter says `Invoices`).
- **Invoice card row** — grid `32px | minmax(0,1fr) | auto | 32px`:
  - Favicon: muted document icon.
  - Info block row 1: invoice number (bold) + copy icon.
  - Info block row 2: client + `.link-dest-meta` (creator avatar + `Issued …` + · + `Due …`).
  - Meta-right: **status pill** (see color map below) + right-aligned amount (tabular numbers, in the invoice's own currency).
  - ⋮ trailing.

#### 14. Invoice canvas (shared by Create modal, Edit page, and Receipt mode)

Rendered by `renderInvoiceCanvas(inv)` in `shell.js`. Structure top-to-bottom:

1. **Top block** — logo upload slot + `Invoice #…` (flips to `Receipt #…` in receipt mode) on the left; big status text (color-coded) + Due Date + **Pay Now** on the right.
2. **Invoiced To / Pay To** — inline-editable inputs. Client Name and Company Name are **bolder** (600, 14px). Right column right-aligns. `TIN: …` sits as the last line under Pay To.
3. **Invoice Date** (left) / **Payment Method** dropdown (right) — default `Paystack (Debit/Credit Cards)`.
4. **Invoice Items** table — dark header row. Two modes (see below).
5. **Add Item** button (left) + **Simple / Detailed** segmented toggle (right). URL-persisted via `?items=simple|detailed`.
6. **Totals + Payment Terms row** — 2-col:
   - **Left**: Payment Terms textarea. When status is `paid`/`partially-paid`, a **dashed container** below holds a diagonal **PAID IN FULL / PARTIALLY PAID** stamp (rotated -14°, green/orange) and a numbered payment history list (amount + method pill + date + optional note).
   - **Right**: Totals card — `+ Additional Charges` · `Subtotal` · `+ Discount` (editable input) · `Tax (7.5%)` · **Amount Due** (or **Invoice Total** in receipt mode). When paid: adds `Amount Paid` and `Balance Due` (red) / `Balance` (green) rows. Below the card: "**In words:** …" line generated by `moneyInWords()` (currency-aware: naira/kobo · dollars/cents · euros/cents · pounds/pence).
7. **Payment Information** — 2-col grid. **Naira account** (left, ₦ black flag) and **USD account** (right, $ flag). Each card has Bank / Account name / Account number / Sort code (or Routing/SWIFT for USD).
8. **Blue tagline strip** — "May the 4th be with you!" (white text centered on `#1d4ed8`).
9. **Sticky floating footer bar** — brand mini-badge · **Currency select** (defaults NGN ₦) · **Status switcher** (opens dropdown of admin statuses: Draft / Sent / Overdue / Cancelled) · **Log Payment** button (only when status is Sent/Overdue/Partially paid) · flex spacer · **Reset** (or **View Receipt** if any payments exist) · **Download PDF** primary.

#### 15. Item modes (Simple vs Detailed)

Toggle right of Add Item.

- **Simple (default)**: `# · Item description · Amount · ⋮`
- **Detailed**: `# · Item description · Qty · Unit Price · Amount · ⋮`

Description textarea auto-wraps and auto-grows (uses CSS `field-sizing: content` + a `autoGrow(el)` JS fallback for older browsers).

Leader column (# + drag handle) and trailing column (delete + duplicate) are both 22×22 stacked with 2px gap so the row height doesn't fluctuate.

#### 16. Create Invoice modal (`prototype/create-invoice.html`)

Modal overlay with `renderInvoiceCanvas` inside. `Esc` and backdrop close it back to the list.

#### 17. Edit Invoice page (`prototype/edit-invoice.html`)

Full page. Crumb bar: `Invoices › INV-435424 ▾` · click-count pill (grand total) · `Send` · `Copy link` · ⋮. **Reads `?inv=N` from URL** so any invoice can be previewed (default 2 = the partially-paid Payflow Labs sample).

**Right rail (300px, sticky top: 20px)** — collapses below the invoice on <1200px:
- Rail title with status pill
- **Client** summary (name + address lines + email)
- **Payment breakdown** (Subtotal · Discount · Tax · Additional charges · Invoice total; adds Amount paid + Balance due when payments exist)
- **Actions**: `Log Payment` primary (status-aware) + `View Receipt` secondary (only when payments exist)
- **Payments list** (numbered) when payments exist

#### 18. Invoice Guide modal (`prototype/invoice-guide.html`)

Modal opened by the `How to Guide` button. Sections:
- **Intro**: "Detailed Breakdown & Guidelines"
- **Blue callout**: default-flow narrative (`Every invoice starts as Draft. When you send it → Sent. Past due → Overdue. Log Payment → Paid or Partially paid. Contract terminated / issued in error → Cancelled. Never delete the record.`)
- **Yellow warn**: don't mark as Paid until the total is fully settled — use Partially paid otherwise.
- **6 numbered step cards** — Draft · Sent · Overdue · Partially paid · Paid · Cancelled — each with the live status pill in its header, and split `When to use / Justification`.
- Footer: `Got it` primary.

#### 19. Row action menu (`prototype/invoice-action-menu.html`)

Dropdown: **Change status →** (sub-flyout with Draft/Sent/Overdue/Cancelled + `is-current` highlight + hint pointing to Log Payment for Paid/Partial) · Edit · Duplicate · Send to client · Download PDF · Copy link · Delete (destructive).

#### 20. Log Payment popup

Opened by the Log Payment button (footer or right rail). Modal:
- `☑ Fully paid` checkbox at top (default checked; toggles Amount disabled/prefilled)
- Amount paid (currency-prefixed, prefilled with outstanding)
- Date + Method (dropdown: Cash / Bank transfer / Card / Paystack / Wire transfer / Other) — 2-col row
- Note (textarea, 2000 char max, live char counter)
- Footer: explanation ("Full → Paid, partial → Partially paid") + Close / Add Payment
- Fully paid → status becomes `paid`; partial → `partially-paid`.

#### 21. Send modal (context-aware)

Opened by header `Send` button. Modal has recipient email, CC, subject, message body. **Attachments** section:
- **No payments yet** → single locked radio: `Invoice` (with note "Receipt option unlocks once a payment is logged")
- **Any payments logged** → three radios: `Receipt only` (default, recommended) · `Invoice only` (resend original bill) · `Invoice + Receipt`.
- Footer: `Send me a copy` toggle + Cancel / Send.

Subject and body autofill differs by mode (invoice vs receipt copy).

#### 22. Empty state (`prototype/invoices-empty.html`)

Analogous to Links empty.

#### 23. Invoice Analytics (`prototype/invoice-analytics.html`)

Tabbed dashboard (query-param `?tab=overview|payments|clients`).

**Always visible KPI row** (4 cards): Total invoice value (USD-normalised via a demo FX table) · Total invoices · Unique clients · Avg days to payment.

**Overview tab**:
- **Invoices by status** — donut chart (200×200) with legend showing count + % per status.
- **Invoice value by status** — horizontal bars in status colors.
- **Invoices processed month on month** — grouped bar chart (one bar per status, side-by-side per month). Bars are chunky (~6px min), rounded, no side gutters (viewBox 960×220 with `preserveAspectRatio` filling the card).

**Payments tab**:
- **Payment velocity** card at the top: overall avg · fastest · slowest.
- Below: **Payment methods by count** (bar chart) + **Payment methods by value** (bar chart) side by side.

**Clients tab**:
- **Invoices processed per client** (bar chart, ranked)
- **Client by invoice amount** (bar chart, ranked by USD value)
- **Client by invoice status** — table with per-client stacked bar showing status distribution.

All charts are inline SVG, share the same status color palette across the app.

---

### Settings

Every settings page uses a shared layout: 220px left sub-nav (icon + label, matches main sidebar treatment) + main column with grouped cards.

**Floating Save bar** — dark pill, bottom-center. Hidden by default; appears only when a field, toggle, or chip changes from its initial value (`initSaveBar()` diffs current vs `_initial` on every input/change/click). On Save: flashes green "Saved!" then hides. On Discard: rewinds every field. A `beforeunload` guard warns before navigation if the form is dirty.

#### 24. Settings — General (`prototype/settings.html`)

- **Workspace**: name · logo · timezone (Africa/Lagos default) · date format (segmented) · language.
- **Your profile**: name · email · avatar · Change password button.
- **Team members**: list of members with role dropdowns (Owner/Editor) + `Invite teammate by email` row.
- **Danger zone**: Transfer ownership · Delete workspace (both `.btn-danger` with red fg + light-red border).

#### 25. Settings — URL Shortener (`prototype/settings-shortener.html`)

- **Domains**:
  - Default domain dropdown (`4th.link` selected).
  - **Custom domains** list — `.setting-list-row.domain-row` per domain: colored favicon square + name/subtitle + status tag (Active green / Pending yellow) + added date + ⋮. `Add custom domain` dashed row.
  - **Root domain redirection** — text input for the destination when the root is hit (empty = 404).
- **Link defaults**: Default folder · Default expiration (Never/7/30/90/1y/Custom) · Default tags (chip toggle list) · Cloak toggle (default OFF) · Custom preview fallback toggle (default ON).

#### 26. Settings — UTM Builder (`prototype/settings-utm.html`)

- **Default parameter values**: default source · medium · campaign · folder.
- **Presets & templates** — list of preset cards (Google Ads · LinkedIn Sponsored · Newsletter · X). Each has a colored square badge, name, preview line showing the utm combo, and edit/duplicate/delete actions. `Add preset` dashed row.
- **URL formatting**: encoding style (Standard RFC 3986 vs Lenient) · space char (`%20` / `+` / `_`) · lowercase parameters toggle · strip existing UTMs toggle.

#### 27. Settings — Invoice (`prototype/settings-invoice.html`)

- **Company profile**: legal name · TIN · registered address · contact email · logo (uses the invoice `.inv-logo-slot` component).
- **Currencies**: default currency dropdown · **Enabled currencies** (chip toggle list: NGN/USD/EUR/GBP on; CAD/ZAR/KES off; `Add currency` chip) · Tax rate (numeric + %).
- **Payment accounts** — list of `.setting-list-row.account-row` per account: flag chip + Bank/account details + **currency dropdown per row** (NGN/USD/EUR/GBP/Other) + edit/delete actions. `Add payment account` dashed row.
- **Payment methods** — list of methods with usage count + individual on/off toggle. `Add custom method` row.
- **Payment terms & numbering**: Default payment terms dropdown (Net 14/30/45/60/Due on receipt/Custom) · Terms note textarea · Invoice number format (Prefix / Padding / Next number).
- **Invoice tagline strip**: on/off toggle · tagline text · background color swatch picker · live preview.
- **Email templates**: invoice subject + body · receipt subject + body. Body helper mentions token variables (`{client}`, `{number}`, `{amount}`, `{due}`, `{payment_date}`).

---

## Interactions & Behavior

### Navigation

| From | Trigger | To |
|---|---|---|
| Sidebar | URL Shortener | `links.html` |
| Sidebar | UTM Builder | `utms.html` |
| Sidebar | Invoice Generator | `invoices.html` |
| Sidebar | Settings | `settings.html` |
| Links list | Sub-nav Analytics | `analytics.html` |
| Invoices list | Sub-nav Analytics | `invoice-analytics.html` |
| Any list | `Create …` button | corresponding create modal |
| Any list | Row click | corresponding edit page |
| Any list | Row ⋮ | corresponding action-menu page |
| Any modal | X, backdrop, or `Esc` | list page |
| Invoices list | How to Guide button | `invoice-guide.html` |
| Any settings page | Left sub-nav | corresponding settings-*.html |

### Invoice state transitions

- New invoice → **Draft**.
- Send it → **Sent**.
- Due date passes without settlement → auto **Overdue**.
- Log Payment (partial) → **Partially paid**.
- Log Payment (full) → **Paid**.
- Log Payment button hidden for Draft, Paid, Cancelled.
- View Receipt button + receipt-mode flip (`Invoice #` → `Receipt #`) appears once at least one payment is logged.

### Live URL preview (UTM Create + Edit)

On any field `oninput`: concat `?utm_source=…&utm_medium=…&utm_campaign=…&utm_id=…&utm_term=…&utm_content=…`, skipping empty values; `encodeURIComponent` every value; update preview innerHTML with color-coded spans + char count.

### Settings save bar

- Initial value snapshot per input on `initSaveBar()`.
- Any `input`/`change`/click on `.setting-chip`/`.setting-seg`/`.btn-danger`/`[data-dirty="true"]` triggers a diff sweep.
- Dirty → `.save-bar.visible`. Save flashes green then hides + resnaps initials. Discard restores initials.

### Auto-grow item descriptions (invoice)

`autoGrow(el)` on `input`; runs once on `DOMContentLoaded` via a `MutationObserver` for the first paint of dynamically rendered rows.

### Focus and hover

- Buttons: `outline: 2px solid var(--foreground); outline-offset: 2px` on `:focus-visible`.
- Inputs: `border-color: var(--foreground)` + `box-shadow: 0 0 0 3px rgba(0,0,0,0.05)` on focus.
- Cards: hover `--muted-2` + subtle shadow bump.

### Toggles

30×18 track, `border-radius: 999px` (only element that stays fully round). 14×14 white thumb translates 12px on `.on`. `150ms` transition.

---

## State Management

Client-side per screen:

- **List views**: search query, active tab, active folder, sort direction. Server-side pagination.
- **Create/Edit Link**: destination, alias, tags, comments, cloak toggle, folder, custom-preview toggle, OG platform tab, advanced settings (UTM/password/expiration on/off + values).
- **Create/Edit UTM**: website, source, medium, campaign, id, term, content, comments, folder. Generated URL is derived.
- **Create/Edit Invoice**: full invoice document + `payments[]` array. Derived state via `computeTotals()`. Item mode + status persisted in URL params for prototype.
- **Log Payment modal**: fully-paid checkbox, amount, date, method, note. On submit → append to `payments[]`, recompute totals, flip status.
- **Send modal**: recipient, cc, subject, body, attachment radio (Invoice/Receipt/Both — receipt options gated on `payments.length > 0`).
- **Row action menu**: which row is expanded (one at a time; closes on outside click).
- **Settings**: dirty state per page — merges dirty inputs and posts once on Save.

No auth or user-scoping in the prototype.

---

## Design Tokens

Defined at `:root` in `prototype/shared.css`.

### Colors

| Token | Value | Usage |
|---|---|---|
| `--background` | `#ffffff` | Base page bg |
| `--foreground` | `#0a0a0a` | Primary text, buttons, ink |
| `--muted` | `#f5f5f5` | Chip/pill bg, hover fills |
| `--muted-2` | `#fafafa` | Sidebar, right-column bg, card hover |
| `--muted-foreground` | `#737373` | Secondary text |
| `--subtle-foreground` | `#a3a3a3` | Placeholder text, dim icons |
| `--border` | `#e5e5e5` | Default border |
| `--border-strong` | `#d4d4d4` | Focused / selected border |
| `--input` | `#e5e5e5` | Same as border |
| `--ring` | `#0a0a0a` | Focus ring |
| `--primary` | `#0a0a0a` | Primary button bg |
| `--primary-foreground` | `#ffffff` | Primary button text |
| `--destructive` | `#dc2626` | Delete actions, required `*` |
| `--accent-yellow` | `#fef3c7` bg / `#854d0e` fg | `Client` tag, UTM `medium` pill |
| `--accent-blue` | `#dbeafe` bg / `#1e40af` fg | `Campaign` tag, UTM `source` pill, Sent status |
| `--accent-green` | `#dcfce7` bg / `#166534` fg | `Internal` tag, UTM `content` pill, Paid status, folder swatches |

### Invoice status colors

| Status | BG | FG | Notes |
|---|---|---|---|
| Draft | `--muted-2` | `--muted-foreground` | Dashed border |
| Sent | `--accent-blue` | `--accent-blue-fg` | |
| Overdue | `#fee2e2` | `#991b1b` | |
| Partially paid | `#ffedd5` | `#9a3412` | |
| Paid | `--accent-green` | `--accent-green-fg` | |
| Cancelled | `--muted` | `--muted-foreground` | Bordered |

### Chart palette (analytics)

Same as status colors — Draft `#a3a3a3` · Sent `#3b82f6` · Overdue `#ef4444` · Partially paid `#f97316` · Paid `#22c55e` · Cancelled `#525252`.

Preview-panel syntax highlight (dark card):
- Base URL → `#ffffff`
- Param key → `#93c5fd`
- Param value → `#fef3c7`
- Separator (`?&=`) → `rgba(255,255,255,0.4)`

### Radius

| Token | Value | Usage |
|---|---|---|
| `--radius-sm` | `6px` | Buttons, inputs, pills, tags, count badges |
| `--radius` | `8px` | Cards, dropdowns, panels |
| `--radius-lg` | `10px` | Modals, edit-page card container |

**Note**: The **only** fully-round element is the toggle switch track. Every other pill/tag/badge uses `--radius-sm` for consistency.

### Shadow

| Token | Value |
|---|---|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.04)` |
| `--shadow` | `0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)` |
| `--shadow-lg` | `0 10px 25px rgba(0,0,0,0.08), 0 4px 10px rgba(0,0,0,0.04)` |
| `--shadow-xl` | `0 20px 50px rgba(0,0,0,0.12), 0 8px 20px rgba(0,0,0,0.06)` |

### Spacing

Informal `4/6/8/10/12/14/16/18/20/22/28px` scale. Common values:
- Card padding: `10px 14px` (list row), `18px 20px` (form column), `16px` (right column).
- Grid gaps: `14px` (list row), `10–14px` (form fields), `20px` (form columns), `12px` (analytics grid).
- Sidebar item: `7px 8px` padding, `4px` gap.

### Typography

| Style | Family | Size | Weight | Line-height |
|---|---|---|---|---|
| Base | Inter | 13 | 400 | 1.5 |
| Page title | Inter | 22 (Settings h1) / 18 (module) | 600 | — |
| Card title | Inter | 15 (Settings) / 13 (module) | 600 | — |
| Label | Inter | 12–13 | 500 | — |
| Helper | Inter | 11–12 | 400 | 1.5 |
| Kbd | Inter | 11 | — | — |
| Stat value | Inter | 20–22 | 600 | — |
| Preview code | SFMono / ui-monospace | 12 | — | 1.55 |
| Pill / count | Inter | 11 | 500 | — |
| Uppercase label (section) | Inter | 11 | 500–600 | letter-spacing 0.04em |

Enable Inter stylistic sets: `font-feature-settings: 'cv02','cv03','cv04','cv11'`.

---

## Assets

All icons are inline SVGs in `prototype/shell.js` (`ICONS` object) and `prototype/settings-shell.js` (`SETTINGS_NAV` per-item icons). There are **no external image assets** — QR code, favicons, and brand marks are inline SVG.

Icon mapping to Lucide:

| Design ICON | Lucide equivalent |
|---|---|
| `link` / URL Shortener | `link-2` |
| `utm` | `sliders-horizontal` |
| `invoice` | `file-text` |
| `filter` | `filter` |
| `sort` | `arrow-up-down` |
| `search` | `search` |
| `plus` / `edit` / `copy` / `more` / `x` / `chevronDown` / `chevronRight` / `chevronLeft` | 1:1 by name |
| `cursor` (click pill) | `mouse-pointer-2` |
| `globe` / `xLogo` / `linkedin` / `facebook` (OG preview tabs) | Lucide + brand SVGs (inline) |
| `lock` / `clock` / `eye` / `shuffle` / `wand` | 1:1 by name |
| `archive` / `duplicate` / `trash` | `archive` / `copy` / `trash-2` |
| `drag` | `grip-vertical` |
| `download` / `reset` / `send` | 1:1 by name |
| `qr` | brand-agnostic inline SVG — regenerate with any QR lib at runtime |

Fonts: **Inter** loaded from Google Fonts (weights 400/500/600/700).

---

## Files

Under `prototype/` in this handoff bundle:

```
shared.css           - all design tokens + component styles (~70KB)
shell.js             - sidebar/shell renderer, ICONS, sample data
                       (SAMPLE_LINKS, SAMPLE_UTMS, SAMPLE_INVOICES),
                       card renderers, computeTotals(), moneyInWords(),
                       Log Payment popup, Send modal, status switcher
settings-shell.js    - Settings sub-nav renderer + save-bar dirty logic

# URL Shortener
links.html               - Links list (default)
links-empty.html         - Links empty state
create-link.html         - Links list + Create Link modal
edit-link.html           - Edit Link full page
action-menu.html         - Links list + row action menu
analytics.html           - Link analytics (placeholder charts)

# UTM Builder
utms.html                - UTM campaigns list
utms-empty.html          - UTM empty state
create-utm.html          - UTM list + Create Campaign modal
edit-utm.html            - Edit Campaign full page
utm-action-menu.html     - UTM list + row action menu

# Invoice Generator
invoices.html            - Invoices list (with status tabs, ?status=)
invoices-empty.html      - Invoices empty state
create-invoice.html      - Invoices list + Create Invoice modal
edit-invoice.html        - Edit Invoice + right rail (?inv=N)
invoice-action-menu.html - Invoices list + row action menu
invoice-guide.html       - How to Guide modal (status flow explainer)
invoice-analytics.html   - Analytics dashboard (?tab=overview|payments|clients)

# Settings
settings.html            - General
settings-shortener.html  - URL Shortener defaults
settings-utm.html        - UTM Builder defaults + presets
settings-invoice.html    - Invoice: company, currencies, accounts, methods, terms, tagline, email
```

At the project root:
- `index.html` — pannable design canvas that renders every prototype in scaled iframes for review. **Not for production.**

---

## Recommended implementation stack

- **Framework**: Next.js (App Router)
- **Styling**: Tailwind CSS
- **Components**: shadcn/ui (Basecoat is essentially shadcn's CSS layer without React deps)
- **Icons**: Lucide + inline brand marks
- **State**: React hooks / Zustand or Jotai for cross-component state (folder filter, active tab, dirty state, session invoice draft)
- **Charts**: inline SVG for parity with the mocks; or Recharts / Visx if the codebase already uses them
- **QR generation**: `qrcode.react` or `qr-code-styling`
- **URL building**: pure client-side — no backend needed for the builder logic
- **PDF export**: `@react-pdf/renderer` or server-side Puppeteer for the invoice/receipt download

If the target codebase already uses a different stack, map the tokens above and use the codebase's own component library — the design tokens carry all the visual detail; the component structure is straightforward.

### Backend touchpoints

- **Auth**: workspace-scoped users with Owner/Editor roles.
- **URL Shortener**: link CRUD, click-tracking pipeline, folder membership, custom-domain verification (CNAME check), root-domain redirection.
- **UTM Builder**: campaign CRUD, folder membership, preset CRUD.
- **Invoice**: invoice CRUD with `payments[]` sub-collection, PDF renderer, email sender (invoice + receipt templates), sequential number allocator honoring `prefix / padding / next number`.
- **Analytics**: derive KPIs and charts server-side from the invoice/payment tables; the client-side aggregations in `invoice-analytics.html` show the intended shape.
- **Settings**: workspace-scoped key/value store for all settings pages. Save bar posts one bundled patch per Save.
