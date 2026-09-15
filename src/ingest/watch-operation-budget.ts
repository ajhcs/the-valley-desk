import type { D1DatabaseLike, D1StatementLike } from "./persistence";

export const WATCH_D1_OPERATION_BUDGET = 750;
export class WatchOperationBudgetError extends Error {
  readonly code = "backoff";
  constructor() { super("watch-d1-operation-budget-exhausted"); }
}

/** Count statement executions, including every statement in an atomic batch.
 * Never split an acceptance batch to fit a remaining allowance. */
export function watchOperationBudget(database: D1DatabaseLike, maximum = WATCH_D1_OPERATION_BUDGET) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > WATCH_D1_OPERATION_BUDGET)
    throw new Error("watch-invalid-operation-budget");
  let used = 0;
  const rawStatements = new WeakMap<D1StatementLike, D1StatementLike>();
  const reserve = (count: number) => {
    if (count > maximum - used) throw new WatchOperationBudgetError();
    used += count;
  };
  const wrap = (raw: D1StatementLike): D1StatementLike => {
    const statement: D1StatementLike = {
      bind: (...values) => wrap(raw.bind(...values)),
      async first<T>() { reserve(1); return raw.first<T>(); },
      async all<T>() { reserve(1); return raw.all<T>(); },
      async run() { reserve(1); return raw.run(); },
    };
    rawStatements.set(statement, raw);
    return statement;
  };
  const db: D1DatabaseLike = {
    prepare: query => wrap(database.prepare(query)),
    async batch(statements) {
      reserve(statements.length);
      return database.batch(statements.map(statement => rawStatements.get(statement) ?? statement));
    },
  };
  return { db, get used() { return used; }, get remaining() { return maximum - used; } };
}
