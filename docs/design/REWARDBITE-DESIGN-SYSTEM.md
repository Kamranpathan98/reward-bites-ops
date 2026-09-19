# RewardBite Canonical Design System

**Visual Source of Truth for RewardBite Platform**  
_Version:_ 1.0.0  
_Status:_ Canonical  
_Last Updated:_ September 2026

---

## 1. Executive Summary & Design Direction

RewardBite is high-throughput restaurant operational infrastructure. The visual system is founded on the principle of:

> **WARM OPERATIONAL SAAS**  
> Crisp, modern, restaurant-focused, operational, precise, warm, trustworthy, calm, and fast to scan.

The design embodies the efficiency of modern SaaS infrastructure paired with the organic warmth of hospitality. It is engineered for demanding restaurant environments: tablet POS terminals behind busy counters, kitchen display systems (KDS) under ambient kitchen glare, and dense multi-location administrative dashboards.

### Core Visual Tenets

1. **Precision & Utility:** High-density data displays, 1px structural dividing lines (`#E2E8F0`), predictable alignments, and zero superfluous ornamentation.
2. **Warm Operational Energy:** Grounded in neutral Slate surfaces (`#0F172A`, `#64748B`, `#F8FAFC`), the system relies on a signature burnt orange/terracotta primary accent (`#EA580C`) that signals culinary craft, hospitality, and focused operational attention without triggering alarm or sensory fatigue.
3. **Rapid Visual Parsing:** Prioritizes instant legibility under fast-paced, ambient restaurant conditions. Layouts favor predictable component architectures, distinct typographic scaling, and high-contrast semantic badges that never rely on color alone.
4. **Anti-Slop Restraint:** Strict rejection of generic AI SaaS aesthetics:
   - NO purple-on-white gradients
   - NO gratuitous glassmorphism or blurry frosted backdrops that impair contrast
   - NO giant decorative gradient blobs or floating shapes
   - NO excessive shadows or dramatic floating-card elevations
   - NO bulbous oversized rounded containers
   - NO random accent colors or arbitrary padding

---

## 2. The Hard Governance Rule

> [!IMPORTANT]
> **"The RewardBite Design System is the visual source of truth."**
>
> Future UI work must NOT silently introduce:
>
> - new colors or random hex values
> - arbitrary fonts or font weight combinations
> - arbitrary spacing (e.g. `p-[18px]`)
> - arbitrary border radii (e.g. `rounded-[14px]`)
> - arbitrary box shadows
> - new component variants without updating the contract
> - new animation patterns
>
> **Governance Workflow:**
> `Identify Requirement → Propose Design System Update → Document Decision → Implement Token/Primitive → Consume in Feature UI`

---

## 3. Token Architecture Chain

Every visual property in RewardBite traces through a single, unbroken chain of truth:

```
Design Token Specification (docs/design/DESIGN-TOKENS.md)
  ↓
CSS Custom Property / Variable (apps/web/src/index.css)
  ↓
Tailwind Semantic Utility Class (apps/web/tailwind.config.ts)
  ↓
Reusable UI Primitives (apps/web/src/components/ui/*)
  ↓
Domain Feature Interfaces (Dashboard, Orders, Tables, KDS, Billing)
```

No hardcoded hex codes or arbitrary inline styles are permitted in feature components.

---

## 4. Documentation Map

The RewardBite Design System is organized into five canonical documents:

| Document                                                       | Purpose                                                                              |
| :------------------------------------------------------------- | :----------------------------------------------------------------------------------- |
| **[REWARDBITE-DESIGN-SYSTEM.md](REWARDBITE-DESIGN-SYSTEM.md)** | Canonical entry point, philosophy, brand principles, governance rules                |
| **[DESIGN-TOKENS.md](DESIGN-TOKENS.md)**                       | Color scales, surfaces, typography, spacing, shape radii, elevations                 |
| **[COMPONENT-LANGUAGE.md](COMPONENT-LANGUAGE.md)**             | Visual contracts for primitives, layout shell, and restaurant domain components      |
| **[MOTION-GUIDELINES.md](MOTION-GUIDELINES.md)**               | Micro-interactions, transitions, marketing reveals, and reduced motion               |
| **[RESPONSIVE-GUIDELINES.md](RESPONSIVE-GUIDELINES.md)**       | Breakpoints (390px, 768px, 1024px, 1440px), touch targets, zero-overflow enforcement |

---

## 5. Stitch Inconsistencies Resolution

During the initial Stitch design audit, a conflict was identified between the auto-generated Material Theme YAML export (`primary: #a33900`, `surface: #f8f9ff`, `secondary: #565e74`) and the curated specification markdown with rendered screens.

The conflict was formally resolved across all tokens:

| Token Role         | Auto-Exported YAML (Discarded)    | Canonical Decision (Adopted)                   | Rationale                                                                                                                                                                                                    |
| :----------------- | :-------------------------------- | :--------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Primary**        | `#A33900` (Muddy brownish orange) | **`#EA580C`** (Warm Terracotta / Burnt Orange) | High vibrancy, hospitality craft feel. 5.02:1 on `#0F172A`; only 3.56:1 on `#FFFFFF`, so it is a brand/large-graphic color, not a text or white-text-fill color. Use `#C2410C` (`primary-strong`) for those. |
| **Primary Strong** | Unspecified                       | **`#C2410C`** (Deep terracotta)                | AA-safe orange: 5.18:1 on white. Default Button/Badge fill and normal-size orange text.                                                                                                                      |
| **Primary Hover**  | `#CC4900`                         | **`#C2410C`** (Deep terracotta)                | Hover for the brand accent; `#9A3412` on `primary-strong` fills.                                                                                                                                             |
| **Primary Active** | Unspecified                       | **`#9A3412`** (Rich burnt terracotta)          | Distinct pressed state feedback.                                                                                                                                                                             |
| **Secondary**      | `#565e74` (Muted purplish slate)  | **`#0F172A`** (Deep Slate 900)                 | Authoritative structure, deep contrast, matches shadcn slate foundation.                                                                                                                                     |
| **Base Canvas**    | `#F8F9FF` (Slight violet tint)    | **`#F8FAFC`** (Slate 50 neutral)               | True neutral backdrop preventing color bias across screens.                                                                                                                                                  |
| **Surface**        | `#FFFFFF`                         | **`#FFFFFF`** (Pure white)                     | Clean card and modal elevation.                                                                                                                                                                              |
| **Muted Surface**  | `#EFF4FF` (Blue tint)             | **`#F1F5F9`** (Slate 100 neutral)              | Subtle table header, hover, and input backgrounds.                                                                                                                                                           |
| **Border**         | `#8E7166` (Brownish outline)      | **`#E2E8F0`** (Slate 200)                      | Crisp 1px structural separator without harsh lines.                                                                                                                                                          |

---

## 6. Coherence Law: One Choice Per Axis

Following the `ui-review` and `ckw-design` quality standards, RewardBite enforces strict coherence across every visual axis:

1. **One Radius Personality:** Soft-geometric (`rounded-lg` / 8px for containers; `rounded` / 4px for inputs, buttons, and badges; `rounded-full` strictly for pills/dots/avatars).
2. **One Primary Brand Accent:** `#EA580C` (Warm Terracotta). Never introduce competing accent hues.
3. **One Icon Family:** Clean line-geometry icons rendered via SVG or standard symbol glyphs using `currentColor`. Never use emoji as UI markers.
4. **One Shadow Language:** Ambient downward light with subtle slate tint (`rgba(15, 23, 42, 0.05)`).
5. **Dual Density Modes:**
   - _Product / Operations:_ Dense, information-rich, compact row padding, instant scanning.
   - _Marketing:_ Spacious, expressive, narrative pacing, generous whitespace.
6. **Nested Radii Law:** Any child element nested within a rounded container must satisfy:
   $$\text{child\_radius} = \max(0, \text{parent\_radius} - \text{padding})$$
   A child corner must never be rounder than its parent container.
