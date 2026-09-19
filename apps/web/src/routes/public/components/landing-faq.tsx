import * as React from 'react';
import { cn } from '@/lib/utils';

interface FAQItem {
  id: string;
  question: string;
  answer: string;
}

const FAQ_ITEMS: FAQItem[] = [
  {
    id: 'faq-1',
    question: 'What is RewardBite?',
    answer:
      'RewardBite is restaurant operations software built for independent restaurants and cafes. It brings tables, orders, the kitchen, and billing into one workflow, so the front of house and the kitchen work from the same information.',
  },
  {
    id: 'faq-2',
    question: 'What can I use today?',
    answer:
      'Self-service restaurant setup, staff sign-in, menu management, tables with printable QR codes, and staff order entry with order statuses. Guest QR ordering, the kitchen display, billing, payments, and the dashboard are coming soon.',
  },
  {
    id: 'faq-3',
    question: 'Will guests be able to order from their phones?',
    answer:
      'That is the plan. Each table already gets its own QR code. Guest ordering from that code is coming soon and will not need an app download.',
  },
  {
    id: 'faq-4',
    question: 'Which payment methods will be supported?',
    answer:
      'Cash and UPI. Payment recording is coming soon, and payment status will be tracked separately from the order status.',
  },
  {
    id: 'faq-5',
    question: 'Does RewardBite include a loyalty or rewards program?',
    answer:
      'No. “Reward every guest” describes what we want the software to make possible: a smoother visit for every guest. There is no loyalty or rewards feature today.',
  },
  {
    id: 'faq-6',
    question: 'Can a small cafe or a single restaurant use it?',
    answer:
      'Yes. RewardBite is built for independent restaurants. Setup is self-service: create your account, then add your menu and tables.',
  },
];

export function LandingFaq(): JSX.Element {
  const [openItems, setOpenItems] = React.useState<Record<string, boolean>>({
    'faq-1': true,
  });

  const toggleItem = (id: string): void => {
    setOpenItems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="w-full max-w-3xl flex flex-col gap-3">
      {FAQ_ITEMS.map((item) => {
        const isOpen = Boolean(openItems[item.id]);
        return (
          <div
            key={item.id}
            className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden"
          >
            <h3>
              <button
                type="button"
                onClick={() => toggleItem(item.id)}
                aria-expanded={isOpen}
                aria-controls={`faq-answer-${item.id}`}
                id={`faq-btn-${item.id}`}
                className="flex w-full min-h-11 items-center justify-between gap-4 p-4 sm:p-5 text-left text-base font-semibold text-foreground hover:bg-surface-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span>{item.question}</span>
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-transform duration-200',
                    isOpen && 'rotate-180',
                  )}
                  aria-hidden="true"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </span>
              </button>
            </h3>
            {isOpen && (
              <div
                id={`faq-answer-${item.id}`}
                role="region"
                aria-labelledby={`faq-btn-${item.id}`}
                className="px-4 sm:px-5 pb-5 pt-3 text-sm text-muted-foreground leading-relaxed border-t border-border-subtle"
              >
                {item.answer}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
