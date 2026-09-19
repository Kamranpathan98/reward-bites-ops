import { z } from 'zod';
import { paiseSchema } from './bills';

export const dashboardSummarySchema = z.object({
  period: z.enum(['today', 'week', 'month']),
  businessDate: z.string(),
  dateRange: z.object({ from: z.string(), to: z.string() }),
  orders: z.object({ completed: z.number().int(), cancelled: z.number().int() }),
  revenuePaise: paiseSchema,
  collectedPaise: paiseSchema,
  collectedByMethod: z.object({
    cashPaise: paiseSchema,
    upiPaise: paiseSchema,
  }),
  outstandingPaise: paiseSchema,
  expensesPaise: paiseSchema,
  operatingResultPaise: z.number().int(),
  aovPaise: paiseSchema,
  disclaimer: z.string(),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

export const dashboardSummaryResponseSchema = z.object({
  data: dashboardSummarySchema,
});
export type DashboardSummaryResponse = z.infer<typeof dashboardSummaryResponseSchema>;

export const breakdownItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  count: z.number().int(),
  totalPaise: paiseSchema,
});
export type BreakdownItem = z.infer<typeof breakdownItemSchema>;

export const dashboardBreakdownSchema = z.object({
  period: z.enum(['today', 'week', 'month']),
  by: z.enum(['type', 'source', 'method', 'expense_category']),
  dateRange: z.object({ from: z.string(), to: z.string() }),
  items: z.array(breakdownItemSchema),
  totalPaise: paiseSchema,
});
export type DashboardBreakdown = z.infer<typeof dashboardBreakdownSchema>;

export const dashboardBreakdownResponseSchema = z.object({
  data: dashboardBreakdownSchema,
});
export type DashboardBreakdownResponse = z.infer<typeof dashboardBreakdownResponseSchema>;

export const dashboardQuerySchema = z.object({
  period: z.enum(['today', 'week', 'month']).default('today'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export const dashboardBreakdownQuerySchema = dashboardQuerySchema.extend({
  by: z.enum(['type', 'source', 'method', 'expense_category']),
});
export type DashboardBreakdownQuery = z.infer<typeof dashboardBreakdownQuerySchema>;

