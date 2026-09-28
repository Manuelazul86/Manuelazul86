/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A very small PostgREST-shaped query builder over in-memory arrays.
 *
 * It covers only the operations the route handlers actually use
 * (select/insert/update/delete with eq, in, or, order, limit and the
 * single/maybeSingle terminators). It exists so the handlers can be
 * tested as handlers — same request, same status codes, same JSON — and
 * it is deliberately dumb: anything it does not implement throws rather
 * than quietly returning the wrong rows.
 */

type Row = Record<string, any>;

interface Filter {
  kind: "eq" | "in" | "not-null" | "gte" | "lt" | "or";
  column?: string;
  value?: any;
}

export interface FakeTables {
  [table: string]: Row[];
}

class QueryBuilder implements PromiseLike<{ data: any; error: any; count?: number }> {
  private filters: Filter[] = [];
  private operation: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | null = null;
  private limitValue: number | null = null;
  private orderBy: { column: string; ascending: boolean } | null = null;
  private single_ = false;
  private maybe = false;
  private headOnly = false;
  private wantCount = false;

  constructor(
    private tables: FakeTables,
    private table: string,
    private onInsert?: (row: Row) => void,
  ) {}

  private get rows(): Row[] {
    this.tables[this.table] ??= [];
    return this.tables[this.table];
  }

  select(_columns?: string, options?: { count?: string; head?: boolean }) {
    if (options?.count) this.wantCount = true;
    if (options?.head) this.headOnly = true;
    return this;
  }

  insert(payload: Row) {
    this.operation = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Row) {
    this.operation = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  in(column: string, value: any[]) {
    this.filters.push({ kind: "in", column, value });
    return this;
  }

  gte(column: string, value: any) {
    this.filters.push({ kind: "gte", column, value });
    return this;
  }

  lt(column: string, value: any) {
    this.filters.push({ kind: "lt", column, value });
    return this;
  }

  not(column: string, operator: string, value: any) {
    if (operator !== "is" || value !== null) {
      throw new Error(`unsupported not.${operator} filter in the fake client`);
    }
    this.filters.push({ kind: "not-null", column });
    return this;
  }

  or(expression: string) {
    this.filters.push({ kind: "or", value: expression });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: options?.ascending ?? true };
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  /** Errors when no row matches, like PostgREST's .single(). */
  single() {
    this.single_ = true;
    this.maybe = false;
    return this;
  }

  /** Returns null when no row matches. */
  maybeSingle() {
    this.single_ = true;
    this.maybe = true;
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every((filter) => {
      switch (filter.kind) {
        case "eq":
          return row[filter.column!] === filter.value;
        case "in":
          return (filter.value as any[]).includes(row[filter.column!]);
        case "gte":
          return row[filter.column!] >= filter.value;
        case "lt":
          return row[filter.column!] < filter.value;
        case "not-null":
          return row[filter.column!] !== null && row[filter.column!] !== undefined;
        case "or": {
          // "name.ilike.%foo%,phone.ilike.%foo%"
          return String(filter.value)
            .split(",")
            .some((clause) => {
              const [column, , pattern] = clause.split(".");
              const needle = (pattern ?? "").replace(/%/g, "").toLowerCase();
              const value = row[column];
              return (
                typeof value === "string" &&
                value.toLowerCase().includes(needle)
              );
            });
        }
        default:
          return true;
      }
    });
  }

  private run() {
    if (this.operation === "insert") {
      const row = { ...this.payload };
      row.id ??= crypto.randomUUID();
      row.created_at ??= new Date().toISOString();
      row.updated_at ??= row.created_at;
      this.rows.push(row);
      this.onInsert?.(row);
      return { data: row, error: null };
    }

    const selected = this.rows.filter((row) => this.matches(row));

    if (this.operation === "update") {
      for (const row of selected) Object.assign(row, this.payload);
      const result = selected;
      return {
        data: this.single_ ? (result[0] ?? null) : result,
        error:
          this.single_ && !this.maybe && result.length === 0
            ? { message: "no rows", code: "PGRST116" }
            : null,
      };
    }

    if (this.operation === "delete") {
      for (const row of selected) {
        const index = this.rows.indexOf(row);
        if (index >= 0) this.rows.splice(index, 1);
      }
      return { data: selected, error: null };
    }

    let result = [...selected];

    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      result.sort((a, b) => {
        const av = a[column] ?? "";
        const bv = b[column] ?? "";
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * (ascending ? 1 : -1);
      });
    }

    const count = result.length;
    if (this.limitValue !== null) result = result.slice(0, this.limitValue);

    if (this.headOnly) return { data: null, error: null, count };

    if (this.single_) {
      return {
        data: result[0] ?? null,
        error:
          !this.maybe && result.length === 0
            ? { message: "no rows", code: "PGRST116" }
            : null,
        count: this.wantCount ? count : undefined,
      };
    }

    return {
      data: result,
      error: null,
      count: this.wantCount ? count : undefined,
    };
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

export function createFakeSupabase(
  tables: FakeTables,
  options: {
    rpc?: (name: string, args: Record<string, unknown>) => any;
    onInsert?: (table: string, row: Row) => void;
  } = {},
) {
  return {
    from(table: string) {
      return new QueryBuilder(tables, table, (row) =>
        options.onInsert?.(table, row),
      );
    },
    async rpc(name: string, args: Record<string, unknown> = {}) {
      if (!options.rpc) return { data: null, error: null };
      try {
        return { data: options.rpc(name, args), error: null };
      } catch (error) {
        return { data: null, error: { message: (error as Error).message } };
      }
    },
  };
}
