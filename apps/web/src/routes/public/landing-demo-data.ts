import type { OperationalStatus } from '@/components/ui/status-badge';

/**
 * Single source of truth for every illustrative value on the landing page.
 *
 * One coherent scenario runs through the page: Table 04 is occupied and
 * Order #1042 is PREPARING (placed 6m 20s ago, table open 24m). Every
 * component that mentions Table 04 or Order #1042 reads from here, so the
 * story cannot drift. These are static presentation values — nothing here is
 * fetched from, or coupled to, the backend.
 */

export function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

export interface DemoMenuItem {
  name: string;
  category: string;
  price: number;
  available: boolean;
}

export const MENU = {
  butterChicken: { name: 'Butter Chicken', category: 'Curries', price: 480, available: true },
  paneerTikka: { name: 'Paneer Tikka', category: 'Starters', price: 380, available: true },
  garlicNaan: { name: 'Garlic Naan', category: 'Breads', price: 70, available: true },
  dalMakhani: { name: 'Dal Makhani', category: 'Curries', price: 340, available: true },
  dumBiryani: { name: 'Dum Biryani', category: 'Rice', price: 420, available: false },
  boondiRaita: { name: 'Boondi Raita', category: 'Sides', price: 90, available: true },
} satisfies Record<string, DemoMenuItem>;

export const GALLERY_MENU_ITEMS: DemoMenuItem[] = [
  MENU.butterChicken,
  MENU.paneerTikka,
  MENU.garlicNaan,
  MENU.dalMakhani,
  MENU.dumBiryani,
];

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export interface DemoOrderLine {
  name: string;
  quantity: number;
  unitPrice: number;
  note?: string;
}

export interface DemoOrder {
  orderNumber: string;
  tableNumber: string;
  status: OperationalStatus;
  age: string;
  lines: DemoOrderLine[];
}

const line = (item: DemoMenuItem, quantity: number, note?: string): DemoOrderLine => ({
  name: item.name,
  quantity,
  unitPrice: item.price,
  ...(note ? { note } : {}),
});

export const ORDER_1042: DemoOrder = {
  orderNumber: '#1042',
  tableNumber: '04',
  status: 'PREPARING',
  age: '6 mins ago',
  lines: [line(MENU.butterChicken, 2, 'Medium spice'), line(MENU.garlicNaan, 4)],
};

export const ORDER_1041: DemoOrder = {
  orderNumber: '#1041',
  tableNumber: '02',
  status: 'READY',
  age: '14 mins ago',
  lines: [line(MENU.paneerTikka, 1), line(MENU.garlicNaan, 3)],
};

export const ORDERS: DemoOrder[] = [
  {
    orderNumber: '#1045',
    tableNumber: '03',
    status: 'NEW',
    age: 'Just now',
    lines: [line(MENU.paneerTikka, 1)],
  },
  {
    orderNumber: '#1044',
    tableNumber: '05',
    status: 'ACCEPTED',
    age: '1 min ago',
    lines: [line(MENU.dumBiryani, 2), line(MENU.boondiRaita, 2)],
  },
  {
    orderNumber: '#1043',
    tableNumber: '01',
    status: 'ACCEPTED',
    age: '2 mins ago',
    lines: [line(MENU.dalMakhani, 1)],
  },
  ORDER_1042,
  ORDER_1041,
];

export const orderTotal = (order: DemoOrder): number =>
  order.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);

export const orderItemCount = (order: DemoOrder): number =>
  order.lines.reduce((sum, l) => sum + l.quantity, 0);

export const orderSummaryText = (order: DemoOrder): string =>
  order.lines.map((l) => `${l.quantity}× ${l.name}`).join(', ');

// ---------------------------------------------------------------------------
// Tables (open sessions)
// ---------------------------------------------------------------------------

export interface DemoTable {
  number: string;
  seats: number;
  occupied: boolean;
  sessionMinutes?: number;
}

export const TABLES: DemoTable[] = [
  { number: '01', seats: 2, occupied: false },
  { number: '02', seats: 4, occupied: true, sessionMinutes: 18 },
  { number: '04', seats: 4, occupied: true, sessionMinutes: 24 },
];

export const table = (number: string): DemoTable | undefined =>
  TABLES.find((t) => t.number === number);

// ---------------------------------------------------------------------------
// Kitchen tickets
// ---------------------------------------------------------------------------

export interface DemoTicket {
  ticketNumber: string;
  tableNumber: string;
  elapsed: string;
  items: Array<{ id: string; name: string; quantity: number; notes?: string }>;
}

export const TICKET_1042: DemoTicket = {
  ticketNumber: 'TICKET #1042',
  tableNumber: 'TABLE 04',
  elapsed: '06:20 min',
  items: [
    { id: 'k1042-a', name: 'Butter Chicken', quantity: 2, notes: 'Medium spice' },
    { id: 'k1042-b', name: 'Garlic Naan', quantity: 4 },
  ],
};

export const GALLERY_TICKETS: DemoTicket[] = [
  {
    ticketNumber: 'TICKET #1043',
    tableNumber: 'TABLE 01',
    elapsed: '02:10 min',
    items: [{ id: 'k1043-a', name: 'Dal Makhani', quantity: 1 }],
  },
  {
    ticketNumber: 'TICKET #1044',
    tableNumber: 'TABLE 05',
    elapsed: '01:05 min',
    items: [
      { id: 'k1044-a', name: 'Dum Biryani', quantity: 2 },
      { id: 'k1044-b', name: 'Boondi Raita', quantity: 2 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Bills
// ---------------------------------------------------------------------------

export interface DemoBill {
  invoiceNumber?: string;
  tableLabel: string;
  items: Array<{ name: string; quantity: number; unitPrice: string; totalPrice: string }>;
  subtotal: string;
  discount?: { name: string; amount: string };
  grandTotal: string;
}

const billItems = (order: DemoOrder): DemoBill['items'] =>
  order.lines.map((l) => ({
    name: l.name,
    quantity: l.quantity,
    unitPrice: formatRupees(l.unitPrice),
    totalPrice: formatRupees(l.quantity * l.unitPrice),
  }));

/** Preview of the bill Table 04 will get once Order #1042 is served (no number until finalized). */
export const BILL_PREVIEW_1042: DemoBill = {
  tableLabel: 'Table 04',
  items: billItems(ORDER_1042),
  subtotal: formatRupees(orderTotal(ORDER_1042)),
  grandTotal: formatRupees(orderTotal(ORDER_1042)),
};

const bill1041Discount = Math.round(orderTotal(ORDER_1041) * 0.1);

/** A settled bill for Table 02 / Order #1041 — shows payment tracked separately from the order. */
export const BILL_PAID_1041: DemoBill = {
  invoiceNumber: '0142',
  tableLabel: 'Table 02',
  items: billItems(ORDER_1041),
  subtotal: formatRupees(orderTotal(ORDER_1041)),
  discount: { name: '10%', amount: formatRupees(bill1041Discount) },
  grandTotal: formatRupees(orderTotal(ORDER_1041) - bill1041Discount),
};

// ---------------------------------------------------------------------------
// Dashboard (V1 metric concepts: orders, revenue, collected, expenses,
// operating result, cash vs UPI, average order value)
// ---------------------------------------------------------------------------

const revenue = 68420;
const cash = 34200;
const upi = 27700;
const expenses = 21300;
const orderCount = 62;

export const DASHBOARD = {
  orders: orderCount,
  revenue,
  collected: cash + upi,
  cash,
  upi,
  expenses,
  operatingResult: revenue - expenses,
  outstanding: revenue - (cash + upi),
  averageOrderValue: Math.round(revenue / orderCount),
} as const;

export const EXPENSE_CAVEAT =
  'Operating result is revenue minus recorded expenses. It excludes stock, tax, salaries and any expense not entered here.';
