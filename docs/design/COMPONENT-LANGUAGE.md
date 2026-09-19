# RewardBite Component Language

This document defines the visual contracts and behavior for all RewardBite component primitives, application shell structures, and restaurant domain components.

---

## 1. General Component Invariants

1. **Class Merging:** All React components accept `className` and merge classes via `cn(...)` (`clsx` + `tailwind-merge`).
2. **Accessible Form Controls:** All inputs, selects, and checkboxes support `id`, `name`, `disabled`, and have associated `<Label>` elements.
3. **Touch Targets:** Any interactive target in touch or POS mode must maintain a minimum bounding box of **44×44px** (Apple HIG / WCAG standard).
4. **Keyboard Focus:** Every interactive control implements a crisp focus ring:
   `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1`
5. **No Emoticons as UI Icons:** Icons are rendered exclusively through SVG glyphs or symbol sets in `currentColor`.

---

## 2. Core UI Primitives

### 2.1 Button (`<Button>`)

- **Purpose:** Primary, secondary, outline, ghost, and destructive interactive triggers.
- **Variants:**
  - `default`: `bg-primary-strong text-primary-foreground hover:bg-primary-active active:bg-primary-pressed shadow-sm` (fill is `#C2410C`, not `#EA580C`, so white text meets AA at 5.18:1)
  - `secondary`: `bg-secondary text-secondary-foreground hover:bg-secondary-hover shadow-sm`
  - `outline`: `border border-border bg-surface text-foreground hover:bg-surface-muted hover:border-border-strong`
  - `ghost`: `bg-transparent text-muted-foreground hover:bg-surface-muted hover:text-foreground`
  - `destructive`: `bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 active:bg-rose-200`
- **Sizes:**
  - `default` (desktop): Height `36px` (`h-9`), padding `px-4 py-2`, font `text-sm font-medium`
  - `sm` (compact): Height `32px` (`h-8`), padding `px-3`, font `text-xs font-medium`
  - `lg` / `touch` (POS): Height `44px` (`h-11`), padding `px-6`, font `text-base font-semibold`
  - `icon`: Square `36×36px` (or `44×44px` on touch/POS) with centered icon glyph
- **States:**
  - Disabled: `opacity-50 pointer-events-none cursor-not-allowed`
  - Loading: Replaces leading icon with a smooth SVG spinner; button remains non-clickable

### 2.2 Input (`<Input>`)

- **Purpose:** Single-line text, number, email, and password entry.
- **Dimensions:** Height `36px` (`h-9`) on desktop, `44px` (`h-11`) on tablet/touch.
- **Styling:**
  - Surface: `bg-surface border border-border text-foreground rounded`
  - Placeholder: `placeholder:text-muted-foreground text-sm`
  - Focus: `focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary`
  - Error: `border-rose-500 focus-visible:ring-rose-500`

### 2.3 Select (`<Select>`)

- **Purpose:** Option selection dropdowns (single select, role pickers, filter controls).
- **Styling:** Matches `<Input>` dimensions, padding, border, and focus states. Displays standard chevron icon on the right edge. Accessible to keyboard navigation and screen readers.

### 2.4 Status Badge (`<StatusBadge>`)

- **Purpose:** Communicates operational lifecycle states across Dashboard, Orders, KDS, Tables, and Billing.
- **Dimensions:** Height `22px`, padding `px-2 py-0.5`, radius `rounded` (`4px`).
- **Typography:** `text-xs font-semibold tabular-nums`
- **Variants (all 9 canonical operational statuses):**
  - `NEW`: `bg-sky-50 text-sky-700 border border-sky-200` + dot/sparkle icon
  - `ACCEPTED`: `bg-indigo-50 text-indigo-700 border border-indigo-200` + checkmark icon
  - `PREPARING`: `bg-amber-50 text-amber-800 border border-amber-200` + cooking icon
  - `READY`: `bg-emerald-50 text-emerald-700 border border-emerald-200` + bell/service icon
  - `COMPLETED`: `bg-slate-100 text-slate-700 border border-slate-200` + double-check icon
  - `PAID`: `bg-emerald-100 text-emerald-800 border border-emerald-300` + payment icon
  - `PENDING`: `bg-orange-50 text-orange-800 border border-orange-200` + clock icon
  - `CANCELLED`: `bg-rose-50 text-rose-700 border border-rose-200` + cancel cross icon
  - `VOID`: `bg-rose-100 text-rose-900 border border-rose-300` + slash/block icon

#### Generic Badge (`<Badge>`)

- `default` uses `bg-primary-strong` (AA under white text). `secondary` is a **quiet neutral** (`bg-surface-muted text-foreground`), deliberately _not_ the deep-slate `secondary` token, so an "inactive" or "none" pill never outweighs an "active" one. Use `variant="muted"`, `success`, `warning`, `info` or `destructive` for tinted states, and the canonical `StatusBadge` for order/payment statuses.

### 2.5 Card (`<Card>`)

- **Purpose:** Primary content grouping container.
- **Hierarchy:** `<Card>`, `<CardHeader>`, `<CardTitle>`, `<CardDescription>`, `<CardContent>`, `<CardFooter>`.
- **Elevation:** Level 1 (`bg-surface border border-border rounded-lg shadow-sm`).
- **Internal Spacing:** Standard `p-5` or `p-6` on desktop; `p-4` on mobile.

### 2.6 Tabs (`<Tabs>`)

- **Purpose:** Pipeline state filters, category selection, and floor section navigation.
- **Styling:** Recessed container `bg-surface-muted p-1 rounded-lg`.
- **Tab Item:** `px-3 py-1.5 text-xs font-semibold rounded transition-all`.
  - Active: `bg-surface text-foreground shadow-sm`
  - Inactive: `text-muted-foreground hover:text-foreground`
  - Count Pill: `px-1.5 py-0.2 rounded-full font-tabular text-caption`
- **Keyboard model:** `TabsList` implements roving tabindex: only the active `TabTrigger` is in the Tab order (`tabIndex=0`, others `-1`). ArrowRight/ArrowLeft move focus and activate the tab (wrapping at the ends); Home/End jump to the first/last tab. Pages wire `role="tabpanel"`, `aria-controls` and `aria-labelledby` themselves.
- **Touch target:** the default trigger is compact (`py-1.5`). On touch-first or marketing surfaces pass `className="min-h-11"`, and let the list wrap (`flex flex-wrap overflow-visible`) rather than scroll, so no tab is hidden behind an invisible scrollbar.

### 2.7 Skeleton (`<Skeleton>`)

- **Purpose:** Graceful loading state placeholder preventing layout reflow (CLS).
- **Styling:** `bg-slate-200/70 animate-pulse rounded`. Mimics the exact geometry of incoming content.

### 2.8 Empty State (`<EmptyState>`)

- **Purpose:** Guides users when lists, queues, or tables contain zero items.
- **Structure:** Centered container with muted illustration/icon, clear bold title, descriptive instruction, and optional primary action button.

### 2.9 Error State (`<ErrorState>`)

- **Purpose:** Graceful display when network requests or operations fail.
- **Structure:** Destructive-tinted or alert banner with specific error reason, help text, and explicit "Retry" button.

---

## 3. Restaurant Domain Components

### 3.1 Metric Card (`<MetricCard>`)

- **Purpose:** Operational and financial KPI cards for Dashboard and Analytics.
- **Elements:**
  - Metric label (uppercase tracking `0.05em`, `text-xs text-muted-foreground`)
  - Primary value in bold **tabular figures** (`text-2xl` or `text-3xl font-bold font-tabular`)
  - Subtitle or comparison delta (e.g. `+14.2% vs yesterday`)
  - Icon container (`w-10 h-10 rounded-lg bg-surface-muted`)
  - Micro progress bar or sparkline indicator at card base

### 3.2 Order Card (`<OrderCard>`)

- **Purpose:** Discrete order item for Kanban pipeline, floor manager rail, and terminal queues.
- **Elements:**
  - Header: Order `#ID` (tabular), Table Number, Source badge (Dine-in / Takeaway / QR)
  - Elapsed timer badge with live indicator
  - Item lines summary (Quantity in tabular, item title, options/variants)
  - Customer note / allergen callout
  - Footer: Total bill amount in bold tabular (`₹1,450`), quick-action buttons (Accept, Bump, Settle)

### 3.3 Kitchen Display Ticket (`<KitchenTicket>`)

- **Purpose:** KDS screen ticket for kitchen staff under high-pace cooking conditions.
- **Visual Design:**
  - High-contrast docket header tinted by urgency:
    - Normal (<10m): `bg-surface-muted text-foreground`
    - Rush (10-15m): `bg-amber-500 text-white`
    - Late (>15m): `bg-rose-600 text-white animate-pulse`
  - Large tabular timer countdown
  - Allergy alert banner: `bg-rose-100 text-rose-800 font-bold px-3 py-1.5`
  - Interactive cooking checklist: 24×24px tap-friendly checkbox with line-through on completed items. Pass `checklist={false}` for illustrations: items render as plain read-only rows with no checkbox or strike-through, so the ticket does not imply per-item completion
  - Primary "Bump Ticket" action button (`h-12 text-base font-bold`)

### 3.4 Table Status Node (`<TableStatus>`)

- **Purpose:** Floor overview and table grid representations.
- **Elements:**
  - Table label: `T-01`, `T-02` (`text-lg font-bold`)
  - Capacity indicator: `4 Pax` (`text-xs text-muted-foreground`)
  - State pill: `OCCUPIED`, `AVAILABLE`, `BILL REQUESTED`, `RESERVED`
  - Active session summary: Elapsed timer, guest count, current bill balance in tabular figures
  - Action shortcuts: View Order, Add Items, Print Bill

### 3.5 Bill Summary (`<BillSummary>`)

- **Purpose:** Financial invoice breakdown for terminal billing and settlement sheets.
- **Elements:**
  - Itemized line rows: Item name, quantity (`tabular`), unit price (`tabular`), total
  - Subtotal calculation row
  - Tax lines (CGST, SGST, VAT) with percentages clearly delineated
  - Service charges and promotional discounts
  - Grand Total: Prominent tabular display with currency symbol (`font-tabular text-xl font-black`)
  - Settlement state badge (`PAID`, `PENDING`)
- **V1 scope:** tax lines and service charge are optional props kept for later; V1 bills carry only a subtotal, an optional discount and a grand total, so V1 screens and marketing illustrations must not pass `taxes` or `serviceCharge`.
- **Heading level:** the title renders as an `h4` by default. Pages that own their heading outline pass `titleAs` (`h2` / `h3` / `h4` / `p`) so the bill never skips a level or adds a stray heading.

### 3.6 Data Table (`<DataTable>`)

- **Purpose:** Dense operational lists (User accounts, order history, inventory, expense records).
- **Invariants:**
  - Sticky header row (`bg-surface-muted text-muted-foreground text-xs font-semibold uppercase`)
  - Row height: standard `48px`, hover background `hover:bg-surface-muted/60`
  - All numerical columns (Currency, Quantities, Timers, IDs) enforce **right-aligned tabular figures**
  - Smooth horizontal scroll container on mobile with no page-level layout blowout
