/**
 * SQLite-backed Repository implementation.
 *
 * A local, persistent drop-in for MemoryRepository. It implements the same
 * Repository/Collection seam (see ./repository.ts), so lib services and API
 * routes don't change — only src/server/store.ts picks which one to build.
 *
 * Design notes:
 *  - Backed by better-sqlite3 (synchronous driver). The Collection interface is
 *    async, so each method wraps the sync call and returns a resolved Promise.
 *  - One table per collection. Columns are named exactly like the TypeScript
 *    field names (camelCase) so row <-> record mapping is a straight pass, with
 *    two exceptions handled per-collection: JSON isn't used, and the single
 *    boolean field (Notification.read) is stored as 0/1.
 *  - `where(predicate)` takes a JS predicate, so we load all rows and filter in
 *    JS — identical semantics to MemoryRepository. Fine for the dataset sizes
 *    this app deals with.
 *  - This is our own local store, not the Postgres target in schema.sql. The
 *    Postgres DDL remains the contract for a future SupabaseRepository.
 */

import Database from 'better-sqlite3';
import type {Database as DatabaseType, Statement} from 'better-sqlite3';
import type {Collection, Repository} from './repository';
import type {
  AppCatalogItem,
  Asset,
  AssetCatalogItem,
  Budget,
  Candidate,
  Company,
  Hire,
  LedgerEntry,
  License,
  Notification,
  Task,
  Template,
  TemplateTask,
  User,
} from './types';

/** A column: its name plus how to encode/decode a single boolean field. */
type ColumnSpec = {
  name: string;
  /** true if this column stores a boolean as INTEGER 0/1. */
  boolean?: boolean;
};

/** Per-table definition: table name and ordered column list. */
interface TableSpec<T> {
  table: string;
  columns: ColumnSpec[];
  // Phantom to keep T bound for type-safety at call sites.
  readonly __type?: T;
}

/**
 * SQLite column type for a field. Numbers map to NUMERIC/REAL, booleans to
 * INTEGER, everything else to TEXT. Nullability is enforced by the type
 * contract and callers, not by NOT NULL constraints, to keep inserts simple.
 */
function columnDdl(
  col: ColumnSpec,
  fieldTypes: Record<string, 'text' | 'number' | 'boolean'>,
): string {
  const kind = fieldTypes[col.name] ?? 'text';
  const sqlType =
    kind === 'number' ? 'NUMERIC'
    : kind === 'boolean' ? 'INTEGER'
    : 'TEXT';
  const pk = col.name === 'id' ? ' PRIMARY KEY' : '';
  return `"${col.name}" ${sqlType}${pk}`;
}

/**
 * One typed collection backed by a SQLite table. Prepared statements are built
 * once per collection and reused.
 */
class SqliteCollection<T extends {id: string}> implements Collection<T> {
  private readonly selectAll: Statement;
  private readonly selectOne: Statement;
  private readonly insertStmt: Statement;
  private readonly deleteStmt: Statement;
  private readonly booleanCols: Set<string>;
  private readonly columnNames: string[];

  constructor(
    private readonly db: DatabaseType,
    private readonly spec: TableSpec<T>,
  ) {
    this.columnNames = spec.columns.map((c) => c.name);
    this.booleanCols = new Set(
      spec.columns.filter((c) => c.boolean).map((c) => c.name),
    );

    const cols = this.columnNames.map((c) => `"${c}"`).join(', ');
    const placeholders = this.columnNames.map((c) => `@${c}`).join(', ');

    this.selectAll = db.prepare(`SELECT ${cols} FROM "${spec.table}"`);
    this.selectOne = db.prepare(
      `SELECT ${cols} FROM "${spec.table}" WHERE "id" = ?`,
    );
    this.insertStmt = db.prepare(
      `INSERT INTO "${spec.table}" (${cols}) VALUES (${placeholders})`,
    );
    this.deleteStmt = db.prepare(`DELETE FROM "${spec.table}" WHERE "id" = ?`);
  }

  /** Record -> row: booleans to 0/1, everything else straight through. */
  private toRow(record: T): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    for (const name of this.columnNames) {
      const value = (record as Record<string, unknown>)[name];
      if (this.booleanCols.has(name)) {
        row[name] = value ? 1 : 0;
      } else {
        row[name] = value === undefined ? null : value;
      }
    }
    return row;
  }

  /** Row -> record: 0/1 back to booleans. */
  private fromRow(row: Record<string, unknown>): T {
    const record: Record<string, unknown> = {};
    for (const name of this.columnNames) {
      const value = row[name];
      record[name] = this.booleanCols.has(name) ? value === 1 : value;
    }
    return record as T;
  }

  async list(): Promise<T[]> {
    const rows = this.selectAll.all() as Record<string, unknown>[];
    return rows.map((r) => this.fromRow(r));
  }

  async get(id: string): Promise<T | null> {
    const row = this.selectOne.get(id) as Record<string, unknown> | undefined;
    return row ? this.fromRow(row) : null;
  }

  async insert(record: T): Promise<T> {
    const existing = this.selectOne.get(record.id);
    if (existing) {
      throw new Error(`Record with id "${record.id}" already exists`);
    }
    this.insertStmt.run(this.toRow(record));
    return record;
  }

  async update(id: string, patch: Partial<T>): Promise<T> {
    const row = this.selectOne.get(id) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error(`Record with id "${id}" not found`);
    }
    const existing = this.fromRow(row);
    // Never let a patch change the primary key.
    const next = {...existing, ...patch, id: existing.id} as T;

    const assignments = this.columnNames
      .filter((c) => c !== 'id')
      .map((c) => `"${c}" = @${c}`)
      .join(', ');
    const stmt = this.db.prepare(
      `UPDATE "${this.spec.table}" SET ${assignments} WHERE "id" = @id`,
    );
    stmt.run(this.toRow(next));
    return next;
  }

  async remove(id: string): Promise<void> {
    this.deleteStmt.run(id);
  }

  async where(predicate: (record: T) => boolean): Promise<T[]> {
    const all = await this.list();
    return all.filter(predicate);
  }
}

// Column + type definitions, mirroring src/lib/types.ts. Keep in sync when the
// type contract changes (see Structure steering: "a new field or table").

const cols = (...names: string[]): ColumnSpec[] =>
  names.map((name) => ({name}));

interface SchemaEntry<T> {
  spec: TableSpec<T>;
  fieldTypes: Record<string, 'text' | 'number' | 'boolean'>;
}

const SCHEMA = {
  companies: {
    spec: {table: 'company', columns: cols('id', 'name', 'size', 'industry')},
    fieldTypes: {size: 'number'},
  } as SchemaEntry<Company>,
  users: {
    spec: {
      table: 'app_user',
      columns: cols('id', 'name', 'email', 'role', 'team', 'managerId'),
    },
    fieldTypes: {},
  } as SchemaEntry<User>,
  appCatalog: {
    spec: {
      table: 'app_catalog',
      columns: cols('id', 'name', 'category', 'costPerSeat', 'billing'),
    },
    fieldTypes: {costPerSeat: 'number'},
  } as SchemaEntry<AppCatalogItem>,
  assetCatalog: {
    spec: {
      table: 'asset_catalog',
      columns: cols(
        'id',
        'name',
        'category',
        'standardCost',
        'depreciationMonths',
      ),
    },
    fieldTypes: {standardCost: 'number', depreciationMonths: 'number'},
  } as SchemaEntry<AssetCatalogItem>,
  assets: {
    spec: {
      table: 'asset',
      columns: cols(
        'id',
        'catalogId',
        'serialTag',
        'status',
        'assignedToHireId',
        'acquiredAt',
        'returnedAt',
      ),
    },
    fieldTypes: {},
  } as SchemaEntry<Asset>,
  templates: {
    spec: {table: 'template', columns: cols('id', 'roleName')},
    fieldTypes: {},
  } as SchemaEntry<Template>,
  templateTasks: {
    spec: {
      table: 'template_task',
      columns: cols(
        'id',
        'templateId',
        'title',
        'ownerTeam',
        'cost',
        'costType',
      ),
    },
    fieldTypes: {cost: 'number'},
  } as SchemaEntry<TemplateTask>,
  hires: {
    spec: {
      table: 'hire',
      columns: cols(
        'id',
        'name',
        'email',
        'roleName',
        'managerId',
        'startDate',
        'cohort',
      ),
    },
    fieldTypes: {},
  } as SchemaEntry<Hire>,
  tasks: {
    spec: {
      table: 'task',
      columns: cols(
        'id',
        'hireId',
        'title',
        'ownerTeam',
        'status',
        'cost',
        'costType',
      ),
    },
    fieldTypes: {cost: 'number'},
  } as SchemaEntry<Task>,
  licenses: {
    spec: {
      table: 'license',
      columns: cols(
        'id',
        'hireId',
        'appId',
        'status',
        'grantedAt',
        'lastUsedAt',
      ),
    },
    fieldTypes: {},
  } as SchemaEntry<License>,
  budgets: {
    spec: {
      table: 'budget',
      columns: cols('id', 'team', 'period', 'limit', 'spent'),
    },
    fieldTypes: {limit: 'number', spent: 'number'},
  } as SchemaEntry<Budget>,
  ledgerEntries: {
    spec: {
      table: 'ledger_entry',
      columns: cols(
        'id',
        'hireId',
        'type',
        'label',
        'amount',
        'costType',
        'refTable',
        'refId',
        'createdAt',
      ),
    },
    fieldTypes: {amount: 'number'},
  } as SchemaEntry<LedgerEntry>,
  notifications: {
    spec: {
      table: 'notification',
      columns: [
        {name: 'id'},
        {name: 'targetTeam'},
        {name: 'message'},
        {name: 'batchId'},
        {name: 'read', boolean: true},
      ],
    },
    fieldTypes: {read: 'boolean'},
  } as SchemaEntry<Notification>,
  candidates: {
    spec: {
      table: 'candidate',
      columns: cols(
        'id',
        'name',
        'title',
        'roleName',
        'hiringManagerId',
        'resumeFile',
        'startDate',
        'status',
        'hireId',
      ),
    },
    fieldTypes: {},
  } as SchemaEntry<Candidate>,
} as const;

/** Create every table if it doesn't already exist. */
function ensureSchema(db: DatabaseType): void {
  for (const entry of Object.values(SCHEMA) as SchemaEntry<{id: string}>[]) {
    const columnsDdl = entry.spec.columns
      .map((c) => columnDdl(c, entry.fieldTypes))
      .join(', ');
    db.exec(`CREATE TABLE IF NOT EXISTS "${entry.spec.table}" (${columnsDdl})`);
  }
}

export class SqliteRepository implements Repository {
  readonly db: DatabaseType;

  companies: Collection<Company>;
  users: Collection<User>;
  appCatalog: Collection<AppCatalogItem>;
  assetCatalog: Collection<AssetCatalogItem>;
  assets: Collection<Asset>;
  templates: Collection<Template>;
  templateTasks: Collection<TemplateTask>;
  hires: Collection<Hire>;
  tasks: Collection<Task>;
  licenses: Collection<License>;
  budgets: Collection<Budget>;
  ledgerEntries: Collection<LedgerEntry>;
  notifications: Collection<Notification>;
  candidates: Collection<Candidate>;

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    ensureSchema(this.db);

    this.companies = new SqliteCollection(this.db, SCHEMA.companies.spec);
    this.users = new SqliteCollection(this.db, SCHEMA.users.spec);
    this.appCatalog = new SqliteCollection(this.db, SCHEMA.appCatalog.spec);
    this.assetCatalog = new SqliteCollection(this.db, SCHEMA.assetCatalog.spec);
    this.assets = new SqliteCollection(this.db, SCHEMA.assets.spec);
    this.templates = new SqliteCollection(this.db, SCHEMA.templates.spec);
    this.templateTasks = new SqliteCollection(
      this.db,
      SCHEMA.templateTasks.spec,
    );
    this.hires = new SqliteCollection(this.db, SCHEMA.hires.spec);
    this.tasks = new SqliteCollection(this.db, SCHEMA.tasks.spec);
    this.licenses = new SqliteCollection(this.db, SCHEMA.licenses.spec);
    this.budgets = new SqliteCollection(this.db, SCHEMA.budgets.spec);
    this.ledgerEntries = new SqliteCollection(
      this.db,
      SCHEMA.ledgerEntries.spec,
    );
    this.notifications = new SqliteCollection(
      this.db,
      SCHEMA.notifications.spec,
    );
    this.candidates = new SqliteCollection(this.db, SCHEMA.candidates.spec);
  }

  /** True if the store has no companies yet — used to decide whether to seed. */
  isEmpty(): boolean {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM "company"')
      .get() as {n: number};
    return row.n === 0;
  }

  close(): void {
    this.db.close();
  }
}

/** Factory kept separate so callers depend on the interface, not the class. */
export function createSqliteRepository(filename: string): SqliteRepository {
  return new SqliteRepository(filename);
}
