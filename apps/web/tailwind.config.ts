import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        surface: {
          DEFAULT: 'hsl(var(--surface))',
          muted: 'hsl(var(--surface-muted))',
          subtle: 'hsl(var(--surface-subtle))',
          elevated: 'hsl(var(--surface-elevated))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          hover: 'hsl(var(--primary-hover))',
          active: 'hsl(var(--primary-active))',
          // AA-safe orange: normal-size text and button fills (see
          // docs/design/DESIGN-TOKENS.md "Accessible primary usage").
          strong: 'hsl(var(--primary-strong))',
          pressed: 'hsl(var(--primary-pressed))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          hover: 'hsl(var(--secondary-hover))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--primary))',
          hover: 'hsl(var(--primary-hover))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        border: {
          DEFAULT: 'hsl(var(--border))',
          subtle: 'hsl(var(--border-subtle))',
          strong: 'hsl(var(--border-strong))',
        },
        ring: 'hsl(var(--focus-ring))',

        // Operational Status Tokens (All 9 Canonical States)
        status: {
          new: {
            DEFAULT: 'hsl(var(--status-new))',
            surface: 'hsl(var(--status-new-surface))',
            border: 'hsl(var(--status-new-border))',
            text: 'hsl(var(--status-new-text))',
          },
          accepted: {
            DEFAULT: 'hsl(var(--status-accepted))',
            surface: 'hsl(var(--status-accepted-surface))',
            border: 'hsl(var(--status-accepted-border))',
            text: 'hsl(var(--status-accepted-text))',
          },
          preparing: {
            DEFAULT: 'hsl(var(--status-preparing))',
            surface: 'hsl(var(--status-preparing-surface))',
            border: 'hsl(var(--status-preparing-border))',
            text: 'hsl(var(--status-preparing-text))',
          },
          ready: {
            DEFAULT: 'hsl(var(--status-ready))',
            surface: 'hsl(var(--status-ready-surface))',
            border: 'hsl(var(--status-ready-border))',
            text: 'hsl(var(--status-ready-text))',
          },
          completed: {
            DEFAULT: 'hsl(var(--status-completed))',
            surface: 'hsl(var(--status-completed-surface))',
            border: 'hsl(var(--status-completed-border))',
            text: 'hsl(var(--status-completed-text))',
          },
          paid: {
            DEFAULT: 'hsl(var(--status-paid))',
            surface: 'hsl(var(--status-paid-surface))',
            border: 'hsl(var(--status-paid-border))',
            text: 'hsl(var(--status-paid-text))',
          },
          pending: {
            DEFAULT: 'hsl(var(--status-pending))',
            surface: 'hsl(var(--status-pending-surface))',
            border: 'hsl(var(--status-pending-border))',
            text: 'hsl(var(--status-pending-text))',
          },
          cancelled: {
            DEFAULT: 'hsl(var(--status-cancelled))',
            surface: 'hsl(var(--status-cancelled-surface))',
            border: 'hsl(var(--status-cancelled-border))',
            text: 'hsl(var(--status-cancelled-text))',
          },
          void: {
            DEFAULT: 'hsl(var(--status-void))',
            surface: 'hsl(var(--status-void-surface))',
            border: 'hsl(var(--status-void-border))',
            text: 'hsl(var(--status-void-text))',
          },
        },
      },
      borderRadius: {
        sm: 'calc(var(--radius) - 6px)', // 2px
        DEFAULT: 'calc(var(--radius) - 4px)', // 4px
        md: 'calc(var(--radius) - 2px)', // 6px
        lg: 'var(--radius)', // 8px
        xl: 'calc(var(--radius) + 4px)', // 12px
        full: '9999px',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(15, 23, 42, 0.05)',
        hover: '0 4px 6px -1px rgba(15, 23, 42, 0.07), 0 2px 4px -2px rgba(15, 23, 42, 0.04)',
        popover: '0 10px 15px -3px rgba(15, 23, 42, 0.08), 0 4px 6px -4px rgba(15, 23, 42, 0.04)',
        modal: '0 20px 25px -5px rgba(15, 23, 42, 0.10), 0 8px 10px -6px rgba(15, 23, 42, 0.04)',
      },
      fontSize: {
        // Canonical `caption-sm` type role (11px / 14px / 500 / +0.02em).
        caption: [
          '0.6875rem',
          { lineHeight: '0.875rem', letterSpacing: '0.02em', fontWeight: '500' },
        ],
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
