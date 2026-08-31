/**
 * Database schema — tenancy, identity and audit foundation.
 *
 * Contract:
 *  - MASTER_IMPLEMENTATION_PLAN.md §3.2 (PostgreSQL, migrations under version control, row-level
 *    security as defence-in-depth, tenant filtering also enforced in the application layer)
 *  - §5 (canonical entities), §20 (immutable audit), §27 (foreign keys, unique/check constraints,
 *    version columns, optimistic concurrency, tenant-scoped indexes)
 *  - IMPLEMENTATION_GAP_CLOSURE_SPEC.md §6.1 (provider-neutral OIDC identity), §7 (tenancy model
 *    and roles), §5 (guest session contract), §40 (audit immutability)
 *
 * The governing idea: **every tenant-owned row carries `organizationId`, and no query may omit it.**
 * Plan §3.2 asks for isolation in both the application layer and the database. Belt and braces is
 * deliberate — cross-tenant disclosure is the highest-severity failure this system can have, and a
 * single forgotten `where` clause should not be sufficient to cause it.
 */

import { sql, relations } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/* -------------------------------------------------------------------------- */
/* Enumerations                                                               */
/* -------------------------------------------------------------------------- */

/** Organisation-level roles (gap-spec §7.2). */
export const organizationRoleEnum = pgEnum('organization_role', [
  'OWNER',
  'ADMIN',
  'MEMBER',
  /** Read-everything, change-nothing. Exists so auditors need no write grant at all. */
  'AUDITOR',
]);

/** Project-level roles (gap-spec §7.3). */
export const projectRoleEnum = pgEnum('project_role', [
  'PROJECT_OWNER',
  'PROJECT_MANAGER',
  'ENGINEER',
  'REVIEWER',
  'APPROVER',
  'VIEWER',
]);

/** Canonical project lifecycle states (plan §6). Transitions are validated centrally in Phase 7. */
export const lifecycleStateEnum = pgEnum('lifecycle_state', [
  'IDEA',
  'DISCOVERY',
  'PLANNING',
  'PLANNED',
  'APPROVED',
  'IN_PROGRESS',
  'VERIFYING',
  'RELEASE_READY',
  'LIVE',
  'OPERATING',
  'COMPLETED',
  'ARCHIVED',
]);

/** V1 supported project classes (gap-spec §4.1). */
export const projectTypeEnum = pgEnum('project_type', [
  'PUBLIC_WEB_APP',
  'SAAS_WEB_APP',
  'INTERNAL_BUSINESS_APP',
  'API_BACKEND_PLATFORM',
  'MOBILE_APP',
  'AI_ENABLED_WEB_APP',
  'DEVELOPER_TOOLING',
  'ECOMMERCE',
  /** Accepted with explicit, surfaced limitations (gap-spec §4.2). */
  'PARTIALLY_SUPPORTED',
  /** The user has not said yet. Never guessed on their behalf. */
  'UNKNOWN',
]);

/* -------------------------------------------------------------------------- */
/* Identity                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Users.
 *
 * Identity is keyed on `(issuer, subject)` — the OIDC pair — never on email. Gap-spec §6.1 requires
 * the provider to stay replaceable, and email is the wrong key regardless: it is mutable, it can be
 * reassigned between people, and two providers can assert the same address.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** OIDC issuer URL. */
    issuer: text('issuer').notNull(),
    /** OIDC subject claim — opaque and stable within an issuer. */
    subject: text('subject').notNull(),
    email: text('email'),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when the account is locked by a security event (gap-spec §6.3). */
    lockedAt: timestamp('locked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('users_issuer_subject_idx').on(table.issuer, table.subject),
    index('users_email_idx').on(table.email),
  ],
);

/* -------------------------------------------------------------------------- */
/* Tenancy                                                                    */
/* -------------------------------------------------------------------------- */

/** Organisations are the tenant boundary. Everything below one belongs to exactly one. */
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    /**
     * External-AI policy for this tenant (plan §19). Enforced server-side: an organisation that has
     * disabled the workflow must not be able to reach it by crafting a request.
     */
    externalAiMode: text('external_ai_mode').notNull().default('USER_CHOICE'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('organizations_slug_idx').on(table.slug),
    check(
      'organizations_external_ai_mode_check',
      sql`${table.externalAiMode} IN ('DISABLED','REDACTED_ONLY','APPROVED_PROVIDERS_ONLY','USER_CHOICE')`,
    ),
  ],
);

/** A user's membership of an organisation. A user may belong to many (gap-spec §7.1). */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: organizationRoleEnum('role').notNull().default('MEMBER'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One membership per user per organisation. Without this, two rows with different roles make
    // the effective permission ambiguous — and ambiguity resolves in the attacker's favour.
    uniqueIndex('memberships_org_user_idx').on(table.organizationId, table.userId),
    index('memberships_user_idx').on(table.userId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Projects                                                                   */
/* -------------------------------------------------------------------------- */

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The tenant key. Present on every tenant-owned table, without exception. */
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    summary: text('summary'),
    projectType: projectTypeEnum('project_type').notNull().default('UNKNOWN'),
    lifecycleState: lifecycleStateEnum('lifecycle_state').notNull().default('IDEA'),

    /**
     * Optimistic concurrency (gap-spec §49). Incremented on every material mutation; a stale write
     * is rejected with a conflict rather than silently overwriting someone else's change.
     */
    version: integer('version').notNull().default(1),

    /** Base currency. One per project (gap-spec §21.1). */
    baseCurrency: text('base_currency').notNull().default('GBP'),

    /**
     * Set while the project belongs to an anonymous guest (gap-spec §5.2). Cleared atomically on
     * signup conversion. A project has either a guest session or an organisation — never neither.
     */
    guestSessionId: uuid('guest_session_id'),

    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Tenant-scoped index (plan §27): every list query filters by organisation first.
    index('projects_org_idx').on(table.organizationId),
    index('projects_org_lifecycle_idx').on(table.organizationId, table.lifecycleState),
    index('projects_guest_session_idx').on(table.guestSessionId),
    check('projects_version_positive', sql`${table.version} >= 1`),
    check('projects_currency_iso', sql`char_length(${table.baseCurrency}) = 3`),
  ],
);

/** A user's role on a specific project (gap-spec §7.3). */
export const projectMembers = pgTable(
  'project_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Denormalised from `projects` deliberately. It lets every authorisation check filter by tenant
     * without a join, so the tenant predicate cannot be lost through a mis-written join condition.
     */
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: projectRoleEnum('role').notNull().default('VIEWER'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('project_members_project_user_idx').on(table.projectId, table.userId),
    index('project_members_org_idx').on(table.organizationId),
    index('project_members_user_idx').on(table.userId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Guest sessions                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Anonymous sessions (gap-spec §5).
 *
 * Guests can complete intake, generate the external-AI prompt, import, validate and preview without
 * an account. The session id lives in an HttpOnly secure cookie; this table holds the server-side
 * state so nothing sensitive is trusted from the client.
 */
export const guestSessions = pgTable(
  'guest_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Guest projects expire automatically (gap-spec §5.3). */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /**
     * Set once converted to an account, so a replayed conversion request is a no-op rather than a
     * second project (gap-spec §5.4, §48).
     */
    convertedToUserId: uuid('converted_to_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    convertedAt: timestamp('converted_at', { withTimezone: true }),
  },
  (table) => [
    index('guest_sessions_expires_idx').on(table.expiresAt),
    check('guest_sessions_expiry_after_creation', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Audit                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Immutable audit log (plan §20, gap-spec §40).
 *
 * Append-only: no update, no delete through the product. Enforced by database triggers in the
 * migration, not by convention — a convention is exactly what an attacker with SQL access ignores,
 * and an audit trail that can be edited is not an audit trail.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null only for pre-tenant events such as a failed sign-in attempt. */
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'restrict',
    }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'restrict' }),
    /** Null for system-initiated actions. */
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorGuestSessionId: uuid('actor_guest_session_id'),
    /** Stable verb, e.g. `PROJECT_CREATED`, `GATE_EVALUATED`, `APPROVAL_GRANTED`. */
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    correlationId: uuid('correlation_id').notNull(),
    /**
     * Safe before/after summary. Redacted before it lands here — the audit log is retained far
     * longer than most data, so a secret written into it is a long-lived exposure.
     */
    summary: jsonb('summary').$type<Record<string, unknown>>(),
    /** Hash of the full before/after, so tampering is detectable without storing the payload. */
    payloadHash: text('payload_hash'),
    reason: text('reason'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_events_org_time_idx').on(table.organizationId, table.occurredAt),
    index('audit_events_project_time_idx').on(table.projectId, table.occurredAt),
    index('audit_events_correlation_idx').on(table.correlationId),
    index('audit_events_actor_idx').on(table.actorUserId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Outbox                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Transactional outbox (gap-spec §47).
 *
 * Written inside the same transaction as the domain change it describes. ADR-0002 chose pg-boss
 * over Redis precisely so this is possible: enqueue and domain write commit together, leaving no
 * window in which a change is committed but its side effect is not yet queued.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    correlationId: uuid('correlation_id').notNull(),
    /** Deduplicates redelivery (gap-spec §48). */
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastErrorCode: text('last_error_code'),
    /** Terminal failure: surfaced rather than retried forever (gap-spec §46). */
    deadLettered: boolean('dead_lettered').notNull().default(false),
  },
  (table) => [
    index('outbox_unprocessed_idx').on(table.processedAt, table.createdAt),
    uniqueIndex('outbox_idempotency_idx').on(table.idempotencyKey),
    index('outbox_correlation_idx').on(table.correlationId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Relations                                                                  */
/* -------------------------------------------------------------------------- */

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  projects: many(projects),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  projectMemberships: many(projectMembers),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  organization: one(organizations, {
    fields: [memberships.organizationId],
    references: [organizations.id],
  }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [projects.organizationId],
    references: [organizations.id],
  }),
  members: many(projectMembers),
}));

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, { fields: [projectMembers.projectId], references: [projects.id] }),
  user: one(users, { fields: [projectMembers.userId], references: [users.id] }),
}));

/* -------------------------------------------------------------------------- */
/* Type exports                                                               */
/* -------------------------------------------------------------------------- */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Organization = typeof organizations.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectMember = typeof projectMembers.$inferSelect;
export type GuestSession = typeof guestSessions.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type OutboxEvent = typeof outboxEvents.$inferSelect;

export type OrganizationRole = (typeof organizationRoleEnum.enumValues)[number];
export type ProjectRole = (typeof projectRoleEnum.enumValues)[number];
export type LifecycleState = (typeof lifecycleStateEnum.enumValues)[number];
export type ProjectType = (typeof projectTypeEnum.enumValues)[number];
