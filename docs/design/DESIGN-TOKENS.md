# RewardBite Design Tokens

This document specifies the canonical design tokens for the RewardBite platform.

---

## 1. Color Tokens

### 1.1 Brand & Core Roles

| Token Name             | CSS Variable                                 | HSL Value        | Hex Equivalent | Description & Usage                                                                                        |
| :--------------------- | :------------------------------------------- | :--------------- | :------------- | :--------------------------------------------------------------------------------------------------------- |
| `primary`              | `--primary`                                  | `21 90% 48%`     | `#EA580C`      | Brand accent: surfaces, dots, borders, focus, large graphics (see 1.1a)                                    |
| `primary-strong`       | `--primary-strong`                           | `17.5 88% 40.4%` | `#C2410C`      | AA-safe orange: normal-size orange text and the default Button/Badge fill under white text                 |
| `primary-hover`        | `--primary-hover`                            | `17.5 88% 40.4%` | `#C2410C`      | Hover state for the brand accent                                                                           |
| `primary-active`       | `--primary-active`                           | `15 79% 34%`     | `#9A3412`      | Hover state for `primary-strong` fills                                                                     |
| `primary-pressed`      | `--primary-pressed`                          | `15 75% 28%`     | `#7C2D12`      | Pressed state for `primary-strong` fills                                                                   |
| `primary-foreground`   | `--primary-foreground`                       | `0 0% 100%`      | `#FFFFFF`      | Text/icons on `primary-strong` (5.18:1). **Not** for use on `primary` #EA580C (3.56:1) at normal text size |
| `secondary`            | `--secondary`                                | `222 47% 11%`    | `#0F172A`      | Deep Slate for headers, sidebars, dark badge backgrounds                                                   |
| `secondary-hover`      | `--secondary-hover`                          | `217 33% 17%`    | `#1E293B`      | Hover state for secondary actions                                                                          |
| `secondary-foreground` | `--secondary-foreground`                     | `210 40% 98%`    | `#F8FAFC`      | Text on secondary dark surfaces                                                                            |
| `accent`               | _(Tailwind alias of `--primary`)_            | `21 90% 48%`     | `#EA580C`      | Synchronized with primary brand accent                                                                     |
| `accent-foreground`    | _(Tailwind alias of `--primary-foreground`)_ | `0 0% 100%`      | `#FFFFFF`      | Text on accent surfaces                                                                                    |
| `focus-ring`           | `--focus-ring`                               | `21 90% 48%`     | `#EA580C`      | Focus outline ring for keyboard accessibility (3.56:1 on white, meets the 3:1 non-text minimum)            |

### 1.1a Using the orange accessibly

The brand orange `#EA580C` keeps its role as the identity color, but it is **3.56:1 on white**, which meets WCAG AA for large text and non-text graphics (3:1) and **fails AA for normal-size text (4.5:1)**. It is _not_ AAA on white. Rules:

| Use                                                              | Token                                         | Contrast                                     |
| :--------------------------------------------------------------- | :-------------------------------------------- | :------------------------------------------- |
| Button/Badge fill carrying white text                            | `bg-primary-strong text-primary-foreground`   | 5.18:1                                       |
| Orange text below 24px (or 18.66px bold)                         | `text-primary-strong`                         | 5.18 white / 4.95 `#F8FAFC` / 4.73 `#F1F5F9` |
| Orange text at 24px+ (or 18.66px+ bold), e.g. hero headline      | `text-primary` or `text-primary-strong`       | 3.56:1 (large-text AA) / 5.18:1              |
| Dots, borders, focus rings, icons, illustrations, progress fills | `primary` (`bg-primary`, `ring-primary`, ...) | 3.56:1 (non-text 3:1)                        |
| Hover / pressed on a `primary-strong` fill                       | `bg-primary-active` / `bg-primary-pressed`    | 7.31:1 / 9.31:1                              |

Never put white text on `bg-primary`, and never set normal-size text in `text-primary`.

### 1.2 Surfaces & Canvas

| Token Name         | CSS Variable         | HSL Value     | Hex Equivalent | Usage                                              |
| :----------------- | :------------------- | :------------ | :------------- | :------------------------------------------------- |
| `background`       | `--background`       | `210 40% 98%` | `#F8FAFC`      | Canvas base background (Slate 50)                  |
| `foreground`       | `--foreground`       | `222 47% 11%` | `#0F172A`      | Primary body and heading text (Slate 900)          |
| `surface`          | `--surface`          | `0 0% 100%`   | `#FFFFFF`      | Data cards, tables, modal dialogs, flyouts         |
| `surface-muted`    | `--surface-muted`    | `210 40% 96%` | `#F1F5F9`      | Table header rows, input backgrounds, subtle hover |
| `surface-subtle`   | `--surface-subtle`   | `210 40% 98%` | `#F8FAFC`      | Inner recessed sections, segmented tab containers  |
| `surface-elevated` | `--surface-elevated` | `0 0% 100%`   | `#FFFFFF`      | Raised popovers, contextual menus, tooltips        |

### 1.3 Borders & Dividers

| Token Name      | CSS Variable      | HSL Value     | Hex Equivalent | Usage                                                 |
| :-------------- | :---------------- | :------------ | :------------- | :---------------------------------------------------- |
| `border`        | `--border`        | `214 32% 91%` | `#E2E8F0`      | Structural card borders, dividers, default separators |
| `border-subtle` | `--border-subtle` | `210 40% 96%` | `#F1F5F9`      | Hairline row dividers in data grids                   |
| `border-strong` | `--border-strong` | `213 27% 84%` | `#CBD5E1`      | Active item borders, input hover borders              |

### 1.4 Neutrals & Typography

| Token Name         | CSS Variable         | HSL Value     | Hex Equivalent | Usage                                                                                                                                    |
| :----------------- | :------------------- | :------------ | :------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| `muted`            | `--muted`            | `210 40% 96%` | `#F1F5F9`      | Inactive pill backgrounds, disabled controls                                                                                             |
| `muted-foreground` | `--muted-foreground` | `215 17% 43%` | `#5B6B80`      | Timestamps, metadata, captions, input placeholders. 5.44:1 on white, 5.20:1 on `#F8FAFC`, 4.97:1 on `#F1F5F9` (AA on every surface tier) |

---

## 2. Operational Status Token System

To eliminate ambiguity across all operational views (Dashboard, Orders, KDS, Tables, Billing, and Payments), the status system defines exact semantic treatments for **all 9 operational states**. Every state mandates:

1. **Foreground color** (text/glyph)
2. **Surface color** (tinted container background)
3. **Border color** (structural outline)
4. **Non-color indicator** (standard icon glyph)
5. **Exact semantic meaning**

| Status        | Foreground Token               | Surface Token                | Border Token                     | Standard Icon                   | Semantic Meaning                                                       |
| :------------ | :----------------------------- | :--------------------------- | :------------------------------- | :------------------------------ | :--------------------------------------------------------------------- |
| **NEW**       | `text-sky-700` (`#0369A1`)     | `bg-sky-50` (`#F0F9FF`)      | `border-sky-200` (`#BAE6FD`)     | `sparkles` / `new_releases`     | Newly placed order or fresh QR session requiring staff acceptance      |
| **ACCEPTED**  | `text-indigo-700` (`#4338CA`)  | `bg-indigo-50` (`#EEF2FF`)   | `border-indigo-200` (`#C7D2FE`)  | `check_circle_outline`          | Order acknowledged by cashier/manager, routed to KDS queue             |
| **PREPARING** | `text-amber-800` (`#92400E`)   | `bg-amber-50` (`#FFFBEB`)    | `border-amber-200` (`#FDE68A`)   | `skillet` / `soup_kitchen`      | Kitchen active preparation in progress                                 |
| **READY**     | `text-emerald-700` (`#047857`) | `bg-emerald-50` (`#ECFDF5`)  | `border-emerald-200` (`#A7F3D0`) | `room_service` / `check_circle` | Food plated, verified, ready for runner to deliver                     |
| **COMPLETED** | `text-slate-700` (`#334155`)   | `bg-slate-100` (`#F1F5F9`)   | `border-slate-200` (`#E2E8F0`)   | `task_alt`                      | Order delivered to customer, dining session fulfilled                  |
| **PAID**      | `text-emerald-800` (`#065F46`) | `bg-emerald-100` (`#D1FAE5`) | `border-emerald-300` (`#6EE7B7`) | `receipt_long` / `payments`     | Settlement completed and verified via cash/UPI/card                    |
| **PENDING**   | `text-orange-800` (`#9A3412`)  | `bg-orange-50` (`#FFF7ED`)   | `border-orange-200` (`#FED7AA`)  | `schedule` / `hourglass_top`    | Awaiting customer action, payment gateway confirmation, or bill call   |
| **CANCELLED** | `text-rose-700` (`#BE123C`)    | `bg-rose-50` (`#FFF1F2`)     | `border-rose-200` (`#FECDD3`)    | `cancel` / `close`              | Voided or cancelled before preparation by customer or staff            |
| **VOID**      | `text-rose-900` (`#881337`)    | `bg-rose-100` (`#FFE4E6`)    | `border-rose-300` (`#FDA4AF`)    | `block` / `remove_circle`       | Revoked financial docket, post-settlement void, or inventory write-off |

> [!IMPORTANT]
> **Accessibility Rule:** Status must **never** be communicated by color alone. Every status badge or indicator must pair the color token with:
>
> - Explicit visible text label
> - Standardized icon glyph or status indicator dot
> - Minimum WCAG AA contrast ratio of 4.5:1 against its container

---

## 3. Typography System

The primary typeface is **Inter**, selected for neutral geometric clarity, extensive weight options, and high legibility at fast-paced viewing distances.

### 3.1 Typographic Scale

| Role          | Font Family | Size             | Line Height | Weight         | Letter Spacing |
| :------------ | :---------- | :--------------- | :---------- | :------------- | :------------- |
| `display`     | Inter       | 36px (2.25rem)   | 44px (1.22) | 700 (Bold)     | `-0.025em`     |
| `headline-lg` | Inter       | 30px (1.875rem)  | 38px (1.26) | 600 (Semibold) | `-0.02em`      |
| `headline-md` | Inter       | 20px (1.25rem)   | 28px (1.40) | 600 (Semibold) | `-0.015em`     |
| `headline-sm` | Inter       | 16px (1rem)      | 24px (1.50) | 600 (Semibold) | `-0.01em`      |
| `body-lg`     | Inter       | 16px (1rem)      | 24px (1.50) | 400 (Regular)  | `-0.005em`     |
| `body-md`     | Inter       | 14px (0.875rem)  | 20px (1.43) | 400 (Regular)  | `0em`          |
| `body-sm`     | Inter       | 12px (0.75rem)   | 16px (1.33) | 400 (Regular)  | `+0.005em`     |
| `label-md`    | Inter       | 14px (0.875rem)  | 20px (1.43) | 500 (Medium)   | `0em`          |
| `label-sm`    | Inter       | 12px (0.75rem)   | 16px (1.33) | 500 (Medium)   | `+0.01em`      |
| `caption-sm`  | Inter       | 11px (0.6875rem) | 14px (1.27) | 500 (Medium)   | `+0.02em`      |

> `caption-sm` is available as the Tailwind utility `text-caption`. Use it instead of arbitrary `text-[10px]` / `text-[11px]`. It is for metadata (count pills, labels); body copy stays at `text-xs` (12px) or larger.

### 3.2 Tabular Numeric Figures (`font-tabular` / `tabular-nums`)

All numerical values that represent live state, currency, or alignment columns must enforce **tabular numerals** via CSS `font-feature-settings: "tnum" 1` or the `tabular-nums` / `font-tabular` utility:

- Currency values (`₹48,250`, `₹1,450.00`)
- Order identifiers (`#1042`, `#1043`)
- Elapsed time and KDS countdown timers (`14m 12s`, `08:45`)
- Table numbers and seat counts (`Table 04`, `4p • 32m`)
- Shift metrics and KPI counts (`14/18 Tables`, `62 paid bills`)

> [!NOTE]
> **Inter with tabular numbers is NOT monospace.** Tabular figures ensure uniform digit widths so columns align vertically without shifting during dynamic updates, while letter glyphs retain proportional kerning. True monospace (`font-mono`) is reserved strictly for system debug logs or raw cryptographic tokens.

---

## 4. Spacing System

RewardBite uses an **8pt modular grid** with **4pt subdivisions** for compact component internals.

| Token       | Pixels | Rem     | Primary Application                                                    |
| :---------- | :----- | :------ | :--------------------------------------------------------------------- |
| `space-xs`  | 4px    | 0.25rem | Badge internal padding, icon-to-label gaps, indicator margins          |
| `space-sm`  | 8px    | 0.5rem  | Input internal padding, card item gaps, compact table cells            |
| `space-md`  | 16px   | 1rem    | Standard card padding, form field vertical gaps, button horizontal pad |
| `space-lg`  | 24px   | 1.5rem  | Card container padding, modal body padding, grid gutters               |
| `space-xl`  | 32px   | 2rem    | Page section spacing, dashboard block separation                       |
| `space-2xl` | 48px   | 3rem    | Major page level spacing, empty state hero gaps                        |

### Dual Density Modes

1. **PRODUCT / OPERATIONS (Dense Mode):**
   - Compact table row height: `44px–48px`
   - Compact card padding: `p-3` or `p-4` (`12px–16px`)
   - Internal gaps: `gap-2` (`8px`)
   - Maximizes data density per viewport on POS screens and order dockets.
2. **MARKETING / LANDING (Spacious Mode):**
   - Generous section padding: `py-16` to `py-24` (`64px–96px`)
   - Relaxed container gutters: `px-6` to `px-12` (`24px–48px`)
   - Headline letter spacing: loose, expressive pacing.

---

## 5. Shape Language & Radii

RewardBite enforces a **Soft-Architectural** geometry:

| Token     | Class          | Radius         | Permitted Usage                                          |
| :-------- | :------------- | :------------- | :------------------------------------------------------- |
| `sm`      | `rounded-sm`   | 2px (0.125rem) | Micro checkboxes, nested tags                            |
| `DEFAULT` | `rounded`      | 4px (0.25rem)  | Form inputs, buttons, status badges, small chips         |
| `md`      | `rounded-md`   | 6px (0.375rem) | Sub-panels, list rows, dropdown menus                    |
| `lg`      | `rounded-lg`   | 8px (0.5rem)   | Primary cards, table containers, POS action tiles        |
| `xl`      | `rounded-xl`   | 12px (0.75rem) | Modal dialogs, drawer sheets, KDS ticket docket wrappers |
| `full`    | `rounded-full` | 9999px         | Status indicator dots, count pills, user avatars ONLY    |

> [!CAUTION]
> **Nested Radii Law:** When an element sits inside a rounded container, its border radius must never exceed the container's radius. The formula is:
> $$\text{radius}_{\text{child}} = \max(0, \text{radius}_{\text{parent}} - \text{padding})$$
> A button (`rounded`) inside a card (`rounded-lg` with `p-4`) produces concentric, parallel curves.

---

## 6. Elevation & Depth System

Visual hierarchy is maintained through subtle, low-opacity ambient shadows paired with 1px structural borders (`#E2E8F0`). Dark skeuomorphic bevels and heavy black drop shadows are forbidden.

| Level        | Role                   | Border              | Box Shadow                                                                        |
| :----------- | :--------------------- | :------------------ | :-------------------------------------------------------------------------------- |
| **Level 0**  | Canvas / Floor         | None                | Flat (`none`)                                                                     |
| **Level 1**  | Resting Cards & Grids  | `1px solid #E2E8F0` | `0 1px 2px 0 rgba(15, 23, 42, 0.05)`                                              |
| **Level 2**  | Hover & Active Tiles   | `1px solid #CBD5E1` | `0 4px 6px -1px rgba(15, 23, 42, 0.07), 0 2px 4px -2px rgba(15, 23, 42, 0.04)`    |
| **Level 3**  | Dropdowns & Popovers   | `1px solid #E2E8F0` | `0 10px 15px -3px rgba(15, 23, 42, 0.08), 0 4px 6px -4px rgba(15, 23, 42, 0.04)`  |
| **Level 4**  | Dialogs & Drawers      | `1px solid #E2E8F0` | `0 20px 25px -5px rgba(15, 23, 42, 0.10), 0 8px 10px -6px rgba(15, 23, 42, 0.04)` |
| **Backdrop** | Modal Backdrop Overlay | None                | `rgba(15, 23, 42, 0.50)` with `backdrop-blur-sm`                                  |
