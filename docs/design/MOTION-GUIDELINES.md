# RewardBite Motion Guidelines

This document specifies the motion timing, transition easing, and choreography rules for the RewardBite platform.

---

## 1. Motion Philosophy

Motion in RewardBite serves **utility and feedback**, not decoration:

1. **Operational Calm:** High-pace restaurant workflows (Kitchen KDS, Table turns, POS billing) require speed. Interfaces must react instantaneously. Animations must never block user input or delay rapid order-taking.
2. **Predictable Physics:** Standard UI elements transition using clean ease-out curves (`cubic-bezier(0.16, 1, 0.3, 1)`). Bouncy, cartoonish spring animations are prohibited in operational screens.
3. **Hardware Efficiency:** Transitions use exclusively hardware-accelerated compositor properties: `opacity` and `transform`. Layout-triggering properties (`width`, `height`, `top`, `margin`) must never be animated.

---

## 2. Motion Duration Scale

| Tier                        | Duration        | Easing Function                           | Applied Elements                                                                     |
| :-------------------------- | :-------------- | :---------------------------------------- | :----------------------------------------------------------------------------------- |
| **Micro-Interactions**      | `120ms – 180ms` | `ease-out` (`cubic-bezier(0, 0, 0.2, 1)`) | Button hover/active states, checkbox checks, switch toggles, tab highlights          |
| **Standard UI Transitions** | `200ms – 300ms` | `cubic-bezier(0.16, 1, 0.3, 1)`           | Dropdown menus, modal dialog entries, slide-out drawer sheets, accordion expansion   |
| **Marketing & Reveals**     | `350ms – 700ms` | `cubic-bezier(0.25, 1, 0.5, 1)`           | Landing page hero entrances, feature section scroll choreography, telemetry counters |

---

## 3. Product vs Marketing Motion Boundary

| Dimension             | Product / Operational UI (App)           | Marketing / Landing Page                      |
| :-------------------- | :--------------------------------------- | :-------------------------------------------- |
| **Pacing**            | Instantaneous, high-cadence, utilitarian | Cinematic, storytelling, spacious             |
| **Scroll Animations** | None (static data views)                 | Scrollytelling, step-driven active highlights |
| **Ticket Bumping**    | Fast slide or immediate fade (150ms)     | N/A                                           |
| **State Badges**      | Instant color switch + subtle 150ms glow | Staggered entrance reveals                    |
| **Hover Feedback**    | Background color transition (120ms)      | Scale & shadow elevation (250ms)              |

---

## 4. Choreography Patterns

### 4.1 Modal & Dialog Entrances

```css
/* Dialog Backdrop */
transition: opacity 200ms ease-out;

/* Dialog Surface */
transform: scale(0.97) translateY(8px);
opacity: 0;
transition:
  transform 250ms cubic-bezier(0.16, 1, 0.3, 1),
  opacity 200ms ease-out;
/* Active State */
transform: scale(1) translateY(0);
opacity: 1;
```

### 4.2 Drawer / Side-Sheet Entrances

- Direction: Slide inward from the right viewport edge (`translateX(100%) → translateX(0)`).
- Duration: `250ms`.
- Timing: `cubic-bezier(0.16, 1, 0.3, 1)`.

### 4.3 KDS Ticket Bump Animation

When a kitchen ticket is completed:

- Card dims opacity: `opacity: 0.5`
- Card translates downward: `translateY(12px)`
- Card collapses cleanly: `transition: opacity 180ms ease-out, transform 180ms ease-out`

---

## 5. Accessibility & Reduced Motion

RewardBite strictly honors the `prefers-reduced-motion` media query across all screens. This block is implemented globally in `apps/web/src/index.css`, so it applies to every route without per-component work:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

When reduced motion is active:

- Slide and scale transforms are disabled; states transition instantaneously or via simple opacity fades.
- Blinking or pulsing urgency badges (`animate-ping`, `animate-pulse`) convert to solid high-contrast borders.
