# RewardBite Responsive Guidelines

This document specifies the responsive breakpoints, viewport adaptations, and mandatory zero-overflow verification requirements for the RewardBite platform.

---

## 1. Breakpoint Architecture

RewardBite aligns with standard Tailwind conventions without introducing arbitrary breakpoint values:

| Target Device              | Viewport Width                        | Tailwind Prefix  | Layout Architecture                                                    |
| :------------------------- | :------------------------------------ | :--------------- | :--------------------------------------------------------------------- |
| **Mobile Phone**           | `< 768px` (target **390px**)          | Default (`base`) | 1-column stacked, full-width cards, drawer overlays, sticky action bar |
| **Tablet Portrait**        | `768px – 1023px` (target **768px**)   | `md:`            | 2-column grids, collapsible sidebar to icon rail, 44px touch targets   |
| **Tablet / POS Landscape** | `1024px – 1279px` (target **1024px**) | `lg:`            | Split view (60% floor/menu canvas, 40% order rail), full sidebar       |
| **Standard Desktop**       | `1280px – 1439px` (target **1280px**) | `xl:`            | 12-column grid, persistent 240px sidebar, expanded table views         |
| **Large POS / KDS Screen** | `≥ 1440px` (target **1440px**)        | `2xl:`           | Multi-column KDS ticket rails (4–6 columns), expansive KPI telemetry   |

---

## 2. Platform-Specific Layout Patterns

### 2.1 Mobile (< 768px / 390px)

- **Navigation:** Bottom navigation bar or top hamburger menu opening a slide-out navigation sheet.
- **Marketing header:** the full inline nav (brand + links + Sign in + primary CTA) needs about 960px, so it only appears from `lg` (1024px). Below `lg` the header is brand + one CTA + a menu button, and the links (and Sign in) live in the menu panel. Do not squeeze the full nav into `md` and never hide overflow to make it fit; verify `document.documentElement.scrollWidth - clientWidth === 0` at 390/768/1024/1440.
- **Data Tables:** Tables do not shrink text into unreadable blobs. Instead, table containers use localized horizontal scrolling (`overflow-x-auto`) or reflow into card-based lists.
- **Modals:** Transform into full-screen sheets or bottom slide-up drawers for natural thumb interaction.
- **Touch Targets:** Minimum 44×44px interactive bounding box on all buttons, inputs, and tab triggers.

### 2.2 Tablet / POS Terminal (768px – 1024px)

- **Dual-Pane Operations:** High-density split screen:
  - Left pane (60%): Interactive floor map, table grid, or item catalog.
  - Right pane (40%): Live order docket with active items, modifiers, totals, and settlement CTA.
- **Physical Counter Ergonomics:** Controls elevated to 44px (`h-11`) to facilitate rapid finger tapping by cashier or server staff.

### 2.3 Desktop (1024px – 1440px+)

- **Global Application Shell:**
  - Fixed 240px left sidebar with quick shift info and audio toggle.
  - Top header (64px) with branch switcher, search shortcut (`⌘K`), and notifications.
  - Flexible main canvas with 12-column grid system.

---

## 3. Mandatory Zero-Horizontal-Overflow Gate

> [!CAUTION]
> **Blocking Requirement: Zero Horizontal Overflow**
>
> You may NOT use `body { overflow-x: clip; }` or `body { overflow-x: hidden; }` to hide layout overflow or force checks to pass.
>
> Horizontal overflow must be fixed at its actual architectural source.
>
> **Verification Condition:**
>
> ```javascript
> document.documentElement.scrollWidth - document.documentElement.clientWidth === 0;
> ```
>
> This equality must hold true across all four target viewports:
> **390px, 768px, 1024px, and 1440px.**

### Root Cause Prevention Checklist

1. **Header & Navigation Rows:** Always specify `flex-wrap: wrap` or provide a controlled mobile overflow menu. Never let a single-row flex container push past the viewport width.
2. **Flex/Grid Track Blowout:** Every flex child containing text or headings must include `min-w-0` to prevent unconstrained content expansion:
   ```html
   <div class="flex items-center min-w-0">
     <span class="truncate">Long Restaurant Item Name</span>
   </div>
   ```
3. **No 100vw Calculations:** Avoid `width: 100vw` inside scrolling containers; use `w-full` (`100%`) to account for scrollbar width.
4. **Tables:** Wrap data tables in a dedicated container with `overflow-x-auto` and `w-full`, isolating horizontal table scrolling to the table element while keeping the page root locked at zero overflow.
5. **No Negative Margins Wider than Gutters:** Ensure negative margins (`-mx-4`) are precisely counterbalanced by container padding.
