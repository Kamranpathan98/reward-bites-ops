import type { QueryResult, QueryResultRow } from 'pg';

/**
 * Who is acting inside a transaction. Mirrors `app.actor_kind` as set by
 * `withTenantTx()` — see the V1 Architecture, section 6.
 */
export type ActorKind = 'staff' | 'customer' | 'system' | 'platform';

/**
 * The single, module-agnostic primitive every repository method takes as
 * its first argument. A repository method that doesn't take a
 * `TransactionContext` is a lint violation (Implementation Blueprint,
 * section 4) — no module may obtain a database connection any other way.
 */
export interface TransactionContext {
  readonly tenantId: string | null;
  readonly userId: string | null;
  readonly actorKind: ActorKind;
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<Row>>;
}
