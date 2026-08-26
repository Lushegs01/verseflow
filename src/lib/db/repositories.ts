/**
 * Repositories: the only place that knows SQL.
 *
 * Services above this layer work with domain objects and never see a row shape,
 * which is what makes the storage engine swappable.
 *
 * Every method takes an optional `Executor`. Passing the transaction handle from
 * `transaction()` enrols the call in that transaction; omitting it uses the shared
 * pool. That is how a multi-table financial write stays atomic.
 */

import {
  getDb, currentTransaction, parseJson, toJson, toBool, toInt,
  type Executor, type Row,
} from "./client";
import type {
  ActivityEvent,
  Agreement,
  AgreementRules,
  AnalyticsEvent,
  AuditLogEntry,
  Dispute,
  DisputeMessage,
  Evidence,
  EvidenceAnalysis,
  Milestone,
  Notification,
  NotificationPreferences,
  Payment,
  RevisionRequest,
  ShowcaseItem,
  User,
  WalletAddress,
} from "@/lib/domain/types";
import { DEFAULT_AGREEMENT_RULES } from "@/lib/domain/types";
import { newId, nowIso } from "@/lib/domain/ids";

/**
 * Resolve the executor, in priority order:
 *   1. an explicit handle passed by the caller
 *   2. the transaction currently in scope, if any
 *   3. the shared pool
 *
 * Step 2 is what lets a service call repositories inside `transaction()` without
 * threading a handle through every function, while still guaranteeing those calls
 * run on the transaction's pinned connection.
 */
async function exec(db?: Executor): Promise<Executor> {
  return db ?? currentTransaction() ?? (await getDb());
}

async function one<T>(db: Executor | undefined, sql: string, params: unknown[], map: (r: Row) => T): Promise<T | null> {
  const e = await exec(db);
  const { rows } = await e.query(sql, params);
  return rows.length > 0 ? map(rows[0]) : null;
}

async function many<T>(db: Executor | undefined, sql: string, params: unknown[], map: (r: Row) => T): Promise<T[]> {
  const e = await exec(db);
  const { rows } = await e.query(sql, params);
  return rows.map(map);
}

async function run(db: Executor | undefined, sql: string, params: unknown[] = []): Promise<void> {
  const e = await exec(db);
  await e.query(sql, params);
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapUser(r: Row): User {
  return {
    id: r.id,
    handle: r.handle,
    displayName: r.display_name,
    headline: r.headline,
    bio: r.bio,
    avatarColor: r.avatar_color,
    email: r.email,
    professions: parseJson(r.professions, []),
    verification: r.verification,
    isAdmin: toBool(r.is_admin),
    publicProfileEnabled: toBool(r.public_profile_enabled),
    publicMetrics: parseJson(r.public_metrics, []),
    timezone: r.timezone,
    createdAt: r.created_at,
  };
}

function mapAgreement(r: Row): Agreement {
  return {
    id: r.id,
    reference: r.reference,
    title: r.title,
    description: r.description,
    clientId: r.client_id,
    providerId: r.provider_id,
    providerInviteAddress: r.provider_invite_address,
    totalAmount: toInt(r.total_amount),
    asset: r.asset,
    status: r.status,
    agreementHash: r.agreement_hash,
    onChainId: r.on_chain_id,
    escrowAddress: r.escrow_address,
    fundingTxHash: r.funding_tx_hash,
    chainId: r.chain_id === null ? null : toInt(r.chain_id),
    rules: parseJson<AgreementRules>(r.rules, DEFAULT_AGREEMENT_RULES),
    clientSignature: parseJson(r.client_signature, null),
    providerSignature: parseJson(r.provider_signature, null),
    expectedCompletionAt: r.expected_completion_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    cancelledAt: r.cancelled_at,
    isSimulated: toBool(r.is_simulated),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapMilestone(r: Row): Milestone {
  return {
    id: r.id,
    agreementId: r.agreement_id,
    position: toInt(r.position),
    title: r.title,
    description: r.description,
    amount: toInt(r.amount),
    dueAt: r.due_at,
    deliverables: parseJson(r.deliverables, []),
    acceptanceCriteria: parseJson(r.acceptance_criteria, []),
    requiredEvidence: parseJson(r.required_evidence, []),
    status: r.status,
    revisionCount: toInt(r.revision_count),
    releasedAmount: toInt(r.released_amount),
    submittedAt: r.submitted_at,
    approvedAt: r.approved_at,
    releasedAt: r.released_at,
    reviewDueAt: r.review_due_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapEvidence(r: Row): Evidence {
  return {
    id: r.id,
    milestoneId: r.milestone_id,
    agreementId: r.agreement_id,
    submittedBy: r.submitted_by,
    round: toInt(r.round),
    kind: r.kind,
    title: r.title,
    source: r.source,
    description: r.description,
    metadata: parseJson(r.metadata, {}),
    hash: r.hash,
    submittedAt: r.submitted_at,
  };
}

function mapAnalysis(r: Row): EvidenceAnalysis {
  return {
    id: r.id,
    milestoneId: r.milestone_id,
    agreementId: r.agreement_id,
    round: toInt(r.round),
    consistency: r.consistency,
    findings: parseJson(r.findings, []),
    recommendation: r.recommendation,
    confidence: toInt(r.confidence),
    summary: r.summary,
    openQuestions: parseJson(r.open_questions, []),
    engine: r.engine,
    createdAt: r.created_at,
  };
}

function mapPayment(r: Row): Payment {
  return {
    id: r.id,
    agreementId: r.agreement_id,
    milestoneId: r.milestone_id,
    kind: r.kind,
    amount: toInt(r.amount),
    asset: r.asset,
    recipientAddress: r.recipient_address,
    status: r.status,
    txHash: r.tx_hash,
    chainId: r.chain_id === null ? null : toInt(r.chain_id),
    blockNumber: r.block_number === null ? null : toInt(r.block_number),
    idempotencyKey: r.idempotency_key,
    reason: r.reason,
    failureReason: r.failure_reason,
    isSimulated: toBool(r.is_simulated),
    initiatedBy: r.initiated_by,
    createdAt: r.created_at,
    confirmedAt: r.confirmed_at,
  };
}

function mapDispute(r: Row): Dispute {
  return {
    id: r.id,
    agreementId: r.agreement_id,
    milestoneId: r.milestone_id,
    openedBy: r.opened_by,
    reason: r.reason,
    detail: r.detail,
    status: r.status,
    resolution: r.resolution,
    resolutionNote: r.resolution_note,
    resolvedProviderAmount: r.resolved_provider_amount === null ? null : toInt(r.resolved_provider_amount),
    resolvedByUserId: r.resolved_by_user_id,
    openedAt: r.opened_at,
    resolvedAt: r.resolved_at,
  };
}

function mapActivity(r: Row): ActivityEvent {
  return {
    id: r.id,
    agreementId: r.agreement_id,
    milestoneId: r.milestone_id,
    actorId: r.actor_id,
    actorLabel: r.actor_label,
    type: r.type,
    summary: r.summary,
    metadata: parseJson(r.metadata, {}),
    txHash: r.tx_hash,
    createdAt: r.created_at,
  };
}

function mapNotification(r: Row): Notification {
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    href: r.href,
    agreementId: r.agreement_id,
    readAt: r.read_at,
    createdAt: r.created_at,
  };
}

function mapWallet(r: Row): WalletAddress {
  return {
    id: r.id,
    userId: r.user_id,
    address: r.address,
    chainId: toInt(r.chain_id),
    label: r.label,
    isPrimary: toBool(r.is_primary),
    verifiedAt: r.verified_at,
    createdAt: r.created_at,
  };
}

function mapRevision(r: Row): RevisionRequest {
  return {
    id: r.id,
    agreementId: r.agreement_id,
    milestoneId: r.milestone_id,
    requestedBy: r.requested_by,
    round: toInt(r.round),
    issue: r.issue,
    requestedAction: r.requested_action,
    unmetCriterionIds: parseJson<string[]>(r.unmet_criterion_ids, []),
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
  };
}

function mapShowcase(r: Row): ShowcaseItem {
  return {
    id: r.id,
    userId: r.user_id,
    agreementId: r.agreement_id,
    publicTitle: r.public_title,
    summary: r.summary,
    anonymizeValue: toBool(r.anonymize_value),
    position: toInt(r.position),
    createdAt: r.created_at,
  };
}

// ---------------------------------------------------------------------------
// Users & wallets
// ---------------------------------------------------------------------------

export const usersRepo = {
  async create(user: Omit<User, "createdAt"> & { createdAt?: string }, db?: Executor): Promise<User> {
    const createdAt = user.createdAt ?? nowIso();
    await run(
      db,
      `INSERT INTO users (id, handle, display_name, headline, bio, avatar_color, email, professions,
        verification, is_admin, public_profile_enabled, public_metrics, timezone, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        user.id, user.handle, user.displayName, user.headline, user.bio, user.avatarColor,
        user.email, toJson(user.professions), user.verification, user.isAdmin,
        user.publicProfileEnabled, toJson(user.publicMetrics), user.timezone, createdAt,
      ],
    );
    return { ...user, createdAt };
  },

  byId: (id: string, db?: Executor) =>
    one(db, "SELECT * FROM users WHERE id = $1", [id], mapUser),

  byHandle: (handle: string, db?: Executor) =>
    one(db, "SELECT * FROM users WHERE handle = $1", [handle], mapUser),

  byAddress: (address: string, db?: Executor) =>
    one(
      db,
      `SELECT u.* FROM users u
       JOIN wallet_addresses w ON w.user_id = u.id
       WHERE lower(w.address) = lower($1) LIMIT 1`,
      [address],
      mapUser,
    ),

  all: (db?: Executor) => many(db, "SELECT * FROM users ORDER BY created_at", [], mapUser),

  async updateProfile(
    id: string,
    patch: Partial<Pick<User, "displayName" | "headline" | "bio" | "professions" | "timezone">>,
    db?: Executor,
  ): Promise<void> {
    const current = await usersRepo.byId(id, db);
    if (!current) return;
    await run(
      db,
      `UPDATE users SET display_name=$1, headline=$2, bio=$3, professions=$4, timezone=$5 WHERE id=$6`,
      [
        patch.displayName ?? current.displayName,
        patch.headline ?? current.headline,
        patch.bio ?? current.bio,
        toJson(patch.professions ?? current.professions),
        patch.timezone ?? current.timezone,
        id,
      ],
    );
  },

  updatePrivacy: (id: string, publicProfileEnabled: boolean, publicMetrics: string[], db?: Executor) =>
    run(db, "UPDATE users SET public_profile_enabled=$1, public_metrics=$2 WHERE id=$3", [
      publicProfileEnabled, toJson(publicMetrics), id,
    ]),
};

export const walletsRepo = {
  async add(w: Omit<WalletAddress, "id" | "createdAt">, db?: Executor): Promise<WalletAddress> {
    const record: WalletAddress = { ...w, id: newId("wal"), createdAt: nowIso() };
    await run(
      db,
      `INSERT INTO wallet_addresses (id, user_id, address, chain_id, label, is_primary, verified_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (address, chain_id) DO UPDATE SET user_id=EXCLUDED.user_id, verified_at=EXCLUDED.verified_at`,
      [
        record.id, record.userId, record.address.toLowerCase(), record.chainId,
        record.label, record.isPrimary, record.verifiedAt, record.createdAt,
      ],
    );
    return record;
  },

  forUser: (userId: string, db?: Executor) =>
    many(
      db,
      "SELECT * FROM wallet_addresses WHERE user_id = $1 ORDER BY is_primary DESC, created_at",
      [userId],
      mapWallet,
    ),

  async primaryAddress(userId: string, db?: Executor): Promise<string | null> {
    const r = await one(
      db,
      "SELECT address FROM wallet_addresses WHERE user_id = $1 ORDER BY is_primary DESC, created_at LIMIT 1",
      [userId],
      (row) => row.address as string,
    );
    return r;
  },

  remove: (id: string, userId: string, db?: Executor) =>
    run(db, "DELETE FROM wallet_addresses WHERE id = $1 AND user_id = $2", [id, userId]),
};

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const sessionsRepo = {
  async create(userId: string, address: string, chainId: number, ttlHours = 24 * 14, db?: Executor) {
    const id = newId("ses");
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + ttlHours * 3_600_000).toISOString();
    await run(
      db,
      "INSERT INTO sessions (id, user_id, address, chain_id, created_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, userId, address.toLowerCase(), chainId, createdAt, expiresAt],
    );
    return { id, userId, address, chainId, createdAt, expiresAt };
  },

  async byId(id: string, db?: Executor) {
    const r = await one(db, "SELECT * FROM sessions WHERE id = $1", [id], (row) => row);
    if (!r) return null;
    if (Date.parse(r.expires_at) < Date.now()) return null;
    return {
      id: r.id as string,
      userId: r.user_id as string,
      address: r.address as string,
      chainId: toInt(r.chain_id),
      expiresAt: r.expires_at as string,
    };
  },

  destroy: (id: string, db?: Executor) => run(db, "DELETE FROM sessions WHERE id = $1", [id]),
};

// ---------------------------------------------------------------------------
// Agreements & milestones
// ---------------------------------------------------------------------------

export const agreementsRepo = {
  async insert(a: Agreement, db?: Executor): Promise<Agreement> {
    await run(
      db,
      `INSERT INTO agreements (id, reference, title, description, client_id, provider_id,
        provider_invite_address, total_amount, asset, status, agreement_hash, on_chain_id,
        escrow_address, funding_tx_hash, chain_id, rules, client_signature, provider_signature,
        expected_completion_at, started_at, completed_at, cancelled_at, is_simulated, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
      [
        a.id, a.reference, a.title, a.description, a.clientId, a.providerId,
        a.providerInviteAddress, a.totalAmount, a.asset, a.status, a.agreementHash, a.onChainId,
        a.escrowAddress, a.fundingTxHash, a.chainId, toJson(a.rules), toJson(a.clientSignature),
        toJson(a.providerSignature), a.expectedCompletionAt, a.startedAt, a.completedAt,
        a.cancelledAt, a.isSimulated, a.createdAt, a.updatedAt,
      ],
    );
    return a;
  },

  async update(a: Agreement, db?: Executor): Promise<Agreement> {
    const updated = { ...a, updatedAt: nowIso() };
    await run(
      db,
      `UPDATE agreements SET title=$1, description=$2, provider_id=$3, provider_invite_address=$4,
        total_amount=$5, asset=$6, status=$7, agreement_hash=$8, on_chain_id=$9, escrow_address=$10,
        funding_tx_hash=$11, chain_id=$12, rules=$13, client_signature=$14, provider_signature=$15,
        expected_completion_at=$16, started_at=$17, completed_at=$18, cancelled_at=$19,
        is_simulated=$20, updated_at=$21
       WHERE id=$22`,
      [
        updated.title, updated.description, updated.providerId, updated.providerInviteAddress,
        updated.totalAmount, updated.asset, updated.status, updated.agreementHash, updated.onChainId,
        updated.escrowAddress, updated.fundingTxHash, updated.chainId, toJson(updated.rules),
        toJson(updated.clientSignature), toJson(updated.providerSignature), updated.expectedCompletionAt,
        updated.startedAt, updated.completedAt, updated.cancelledAt, updated.isSimulated,
        updated.updatedAt, updated.id,
      ],
    );
    return updated;
  },

  byId: (id: string, db?: Executor) =>
    one(db, "SELECT * FROM agreements WHERE id = $1", [id], mapAgreement),

  byReference: (reference: string, db?: Executor) =>
    one(db, "SELECT * FROM agreements WHERE reference = $1", [reference], mapAgreement),

  forUser: (userId: string, db?: Executor) =>
    many(
      db,
      "SELECT * FROM agreements WHERE client_id = $1 OR provider_id = $1 ORDER BY updated_at DESC",
      [userId],
      mapAgreement,
    ),

  all: (db?: Executor) =>
    many(db, "SELECT * FROM agreements ORDER BY created_at DESC", [], mapAgreement),

  async nextSequence(db?: Executor): Promise<number> {
    const r = await one(db, "SELECT COUNT(*)::int AS c FROM agreements", [], (row) => toInt(row.c));
    return (r ?? 0) + 1;
  },
};

export const milestonesRepo = {
  async insert(m: Milestone, db?: Executor): Promise<Milestone> {
    await run(
      db,
      `INSERT INTO milestones (id, agreement_id, position, title, description, amount, due_at,
        deliverables, acceptance_criteria, required_evidence, status, revision_count,
        released_amount, submitted_at, approved_at, released_at, review_due_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        m.id, m.agreementId, m.position, m.title, m.description, m.amount, m.dueAt,
        toJson(m.deliverables), toJson(m.acceptanceCriteria), toJson(m.requiredEvidence),
        m.status, m.revisionCount, m.releasedAmount, m.submittedAt, m.approvedAt, m.releasedAt,
        m.reviewDueAt, m.createdAt, m.updatedAt,
      ],
    );
    return m;
  },

  async update(m: Milestone, db?: Executor): Promise<Milestone> {
    const updated = { ...m, updatedAt: nowIso() };
    await run(
      db,
      `UPDATE milestones SET position=$1, title=$2, description=$3, amount=$4, due_at=$5, deliverables=$6,
        acceptance_criteria=$7, required_evidence=$8, status=$9, revision_count=$10, released_amount=$11,
        submitted_at=$12, approved_at=$13, released_at=$14, review_due_at=$15, updated_at=$16
       WHERE id=$17`,
      [
        updated.position, updated.title, updated.description, updated.amount, updated.dueAt,
        toJson(updated.deliverables), toJson(updated.acceptanceCriteria), toJson(updated.requiredEvidence),
        updated.status, updated.revisionCount, updated.releasedAmount, updated.submittedAt,
        updated.approvedAt, updated.releasedAt, updated.reviewDueAt, updated.updatedAt, updated.id,
      ],
    );
    return updated;
  },

  byId: (id: string, db?: Executor) =>
    one(db, "SELECT * FROM milestones WHERE id = $1", [id], mapMilestone),

  forAgreement: (agreementId: string, db?: Executor) =>
    many(db, "SELECT * FROM milestones WHERE agreement_id = $1 ORDER BY position", [agreementId], mapMilestone),

  deleteForAgreement: (agreementId: string, db?: Executor) =>
    run(db, "DELETE FROM milestones WHERE agreement_id = $1", [agreementId]),

  all: (db?: Executor) => many(db, "SELECT * FROM milestones", [], mapMilestone),
};

// ---------------------------------------------------------------------------
// Evidence & analysis
// ---------------------------------------------------------------------------

export const evidenceRepo = {
  async insert(e: Evidence, db?: Executor): Promise<Evidence> {
    await run(
      db,
      `INSERT INTO evidence (id, milestone_id, agreement_id, submitted_by, round, kind, title,
        source, description, metadata, hash, submitted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        e.id, e.milestoneId, e.agreementId, e.submittedBy, e.round, e.kind, e.title,
        e.source, e.description, toJson(e.metadata), e.hash, e.submittedAt,
      ],
    );
    return e;
  },

  forMilestone: (milestoneId: string, db?: Executor) =>
    many(db, "SELECT * FROM evidence WHERE milestone_id = $1 ORDER BY submitted_at", [milestoneId], mapEvidence),

  forMilestoneRound: (milestoneId: string, round: number, db?: Executor) =>
    many(
      db,
      "SELECT * FROM evidence WHERE milestone_id = $1 AND round = $2 ORDER BY submitted_at",
      [milestoneId, round],
      mapEvidence,
    ),

  async countForAgreement(agreementId: string, db?: Executor): Promise<number> {
    const r = await one(
      db, "SELECT COUNT(*)::int AS c FROM evidence WHERE agreement_id = $1", [agreementId],
      (row) => toInt(row.c),
    );
    return r ?? 0;
  },
};

export const analysisRepo = {
  async insert(a: EvidenceAnalysis, db?: Executor): Promise<EvidenceAnalysis> {
    await run(
      db,
      `INSERT INTO evidence_analyses (id, milestone_id, agreement_id, round, consistency, findings,
        recommendation, confidence, summary, open_questions, engine, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        a.id, a.milestoneId, a.agreementId, a.round, a.consistency, toJson(a.findings),
        a.recommendation, a.confidence, a.summary, toJson(a.openQuestions), a.engine, a.createdAt,
      ],
    );
    return a;
  },

  latestForMilestone: (milestoneId: string, db?: Executor) =>
    one(
      db,
      "SELECT * FROM evidence_analyses WHERE milestone_id = $1 ORDER BY created_at DESC LIMIT 1",
      [milestoneId],
      mapAnalysis,
    ),
};

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const paymentsRepo = {
  async insert(p: Payment, db?: Executor): Promise<Payment> {
    await run(
      db,
      `INSERT INTO payments (id, agreement_id, milestone_id, kind, amount, asset, recipient_address,
        status, tx_hash, chain_id, block_number, idempotency_key, reason, failure_reason,
        is_simulated, initiated_by, created_at, confirmed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        p.id, p.agreementId, p.milestoneId, p.kind, p.amount, p.asset, p.recipientAddress,
        p.status, p.txHash, p.chainId, p.blockNumber, p.idempotencyKey, p.reason, p.failureReason,
        p.isSimulated, p.initiatedBy, p.createdAt, p.confirmedAt,
      ],
    );
    return p;
  },

  async update(p: Payment, db?: Executor): Promise<Payment> {
    await run(
      db,
      `UPDATE payments SET status=$1, tx_hash=$2, chain_id=$3, block_number=$4, failure_reason=$5, confirmed_at=$6
       WHERE id=$7`,
      [p.status, p.txHash, p.chainId, p.blockNumber, p.failureReason, p.confirmedAt, p.id],
    );
    return p;
  },

  byId: (id: string, db?: Executor) =>
    one(db, "SELECT * FROM payments WHERE id = $1", [id], mapPayment),

  byIdempotencyKey: (key: string, db?: Executor) =>
    one(db, "SELECT * FROM payments WHERE idempotency_key = $1", [key], mapPayment),

  byTxHash: (hash: string, db?: Executor) =>
    one(db, "SELECT * FROM payments WHERE tx_hash = $1", [hash], mapPayment),

  forAgreement: (agreementId: string, db?: Executor) =>
    many(db, "SELECT * FROM payments WHERE agreement_id = $1 ORDER BY created_at", [agreementId], mapPayment),

  forMilestone: (milestoneId: string, db?: Executor) =>
    many(db, "SELECT * FROM payments WHERE milestone_id = $1 ORDER BY created_at", [milestoneId], mapPayment),

  all: (db?: Executor) =>
    many(db, "SELECT * FROM payments ORDER BY created_at DESC", [], mapPayment),

  /** Total confirmed value released for a milestone. The ledger is the source of truth. */
  async confirmedTotalForMilestone(milestoneId: string, db?: Executor): Promise<number> {
    const r = await one(
      db,
      `SELECT COALESCE(SUM(amount),0)::int AS t FROM payments
       WHERE milestone_id = $1 AND status = 'confirmed' AND kind <> 'refund'`,
      [milestoneId],
      (row) => toInt(row.t),
    );
    return r ?? 0;
  },
};

// ---------------------------------------------------------------------------
// Revisions & disputes
// ---------------------------------------------------------------------------

export const revisionsRepo = {
  async insert(r: RevisionRequest, db?: Executor): Promise<RevisionRequest> {
    await run(
      db,
      `INSERT INTO revision_requests (id, agreement_id, milestone_id, requested_by, round, issue,
        requested_action, unmet_criterion_ids, resolved_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        r.id, r.agreementId, r.milestoneId, r.requestedBy, r.round, r.issue,
        r.requestedAction, toJson(r.unmetCriterionIds), r.resolvedAt, r.createdAt,
      ],
    );
    return r;
  },

  forMilestone: (milestoneId: string, db?: Executor) =>
    many(
      db,
      "SELECT * FROM revision_requests WHERE milestone_id = $1 ORDER BY created_at",
      [milestoneId],
      mapRevision,
    ),

  resolveOpen: (milestoneId: string, db?: Executor) =>
    run(db, "UPDATE revision_requests SET resolved_at = $1 WHERE milestone_id = $2 AND resolved_at IS NULL", [
      nowIso(), milestoneId,
    ]),
};

export const disputesRepo = {
  async insert(d: Dispute, db?: Executor): Promise<Dispute> {
    await run(
      db,
      `INSERT INTO disputes (id, agreement_id, milestone_id, opened_by, reason, detail, status,
        resolution, resolution_note, resolved_provider_amount, resolved_by_user_id, opened_at, resolved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        d.id, d.agreementId, d.milestoneId, d.openedBy, d.reason, d.detail, d.status,
        d.resolution, d.resolutionNote, d.resolvedProviderAmount, d.resolvedByUserId, d.openedAt, d.resolvedAt,
      ],
    );
    return d;
  },

  async update(d: Dispute, db?: Executor): Promise<Dispute> {
    await run(
      db,
      `UPDATE disputes SET status=$1, resolution=$2, resolution_note=$3, resolved_provider_amount=$4,
        resolved_by_user_id=$5, resolved_at=$6 WHERE id=$7`,
      [d.status, d.resolution, d.resolutionNote, d.resolvedProviderAmount, d.resolvedByUserId, d.resolvedAt, d.id],
    );
    return d;
  },

  byId: (id: string, db?: Executor) =>
    one(db, "SELECT * FROM disputes WHERE id = $1", [id], mapDispute),

  forMilestone: (milestoneId: string, db?: Executor) =>
    one(db, "SELECT * FROM disputes WHERE milestone_id = $1 ORDER BY opened_at DESC LIMIT 1", [milestoneId], mapDispute),

  forAgreement: (agreementId: string, db?: Executor) =>
    many(db, "SELECT * FROM disputes WHERE agreement_id = $1 ORDER BY opened_at DESC", [agreementId], mapDispute),

  all: (db?: Executor) =>
    many(db, "SELECT * FROM disputes ORDER BY opened_at DESC", [], mapDispute),

  async addMessage(m: DisputeMessage, db?: Executor): Promise<DisputeMessage> {
    await run(
      db,
      "INSERT INTO dispute_messages (id, dispute_id, author_id, body, created_at) VALUES ($1,$2,$3,$4,$5)",
      [m.id, m.disputeId, m.authorId, m.body, m.createdAt],
    );
    return m;
  },

  messages: (disputeId: string, db?: Executor) =>
    many(
      db,
      "SELECT * FROM dispute_messages WHERE dispute_id = $1 ORDER BY created_at",
      [disputeId],
      (r) => ({
        id: r.id, disputeId: r.dispute_id, authorId: r.author_id,
        body: r.body, createdAt: r.created_at,
      }),
    ),
};

// ---------------------------------------------------------------------------
// Activity, notifications, showcase, analytics, audit
// ---------------------------------------------------------------------------

export const activityRepo = {
  async insert(e: ActivityEvent, db?: Executor): Promise<ActivityEvent> {
    await run(
      db,
      `INSERT INTO activity_events (id, agreement_id, milestone_id, actor_id, actor_label, type,
        summary, metadata, tx_hash, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        e.id, e.agreementId, e.milestoneId, e.actorId, e.actorLabel, e.type,
        e.summary, toJson(e.metadata), e.txHash, e.createdAt,
      ],
    );
    return e;
  },

  forAgreement: (agreementId: string, db?: Executor) =>
    many(
      db,
      "SELECT * FROM activity_events WHERE agreement_id = $1 ORDER BY created_at DESC",
      [agreementId],
      mapActivity,
    ),

  recent: (limit = 50, db?: Executor) =>
    many(db, "SELECT * FROM activity_events ORDER BY created_at DESC LIMIT $1", [limit], mapActivity),
};

export const notificationsRepo = {
  async insert(n: Notification, db?: Executor): Promise<Notification> {
    await run(
      db,
      `INSERT INTO notifications (id, user_id, kind, title, body, href, agreement_id, read_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [n.id, n.userId, n.kind, n.title, n.body, n.href, n.agreementId, n.readAt, n.createdAt],
    );
    return n;
  },

  forUser: (userId: string, limit = 50, db?: Executor) =>
    many(
      db,
      "SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
      [userId, limit],
      mapNotification,
    ),

  async unreadCount(userId: string, db?: Executor): Promise<number> {
    const r = await one(
      db,
      "SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND read_at IS NULL",
      [userId],
      (row) => toInt(row.c),
    );
    return r ?? 0;
  },

  async markRead(userId: string, ids: string[] | null, db?: Executor): Promise<void> {
    const at = nowIso();
    if (!ids || ids.length === 0) {
      await run(db, "UPDATE notifications SET read_at=$1 WHERE user_id=$2 AND read_at IS NULL", [at, userId]);
      return;
    }
    await run(db, "UPDATE notifications SET read_at=$1 WHERE user_id=$2 AND id = ANY($3::text[])", [
      at, userId, ids,
    ]);
  },

  async preferences(userId: string, db?: Executor): Promise<NotificationPreferences> {
    const r = await one(db, "SELECT * FROM notification_preferences WHERE user_id = $1", [userId], (row) => row);
    return {
      userId,
      channels: parseJson(r?.channels, {} as NotificationPreferences["channels"]),
      digestMode: toBool(r?.digest_mode),
    };
  },

  savePreferences: (prefs: NotificationPreferences, db?: Executor) =>
    run(
      db,
      `INSERT INTO notification_preferences (user_id, channels, digest_mode) VALUES ($1,$2,$3)
       ON CONFLICT (user_id) DO UPDATE SET channels=EXCLUDED.channels, digest_mode=EXCLUDED.digest_mode`,
      [prefs.userId, toJson(prefs.channels), prefs.digestMode],
    ),
};

export const showcaseRepo = {
  async upsert(item: ShowcaseItem, db?: Executor): Promise<ShowcaseItem> {
    await run(
      db,
      `INSERT INTO showcase_items (id, user_id, agreement_id, public_title, summary, anonymize_value, position, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (user_id, agreement_id) DO UPDATE SET public_title=EXCLUDED.public_title,
         summary=EXCLUDED.summary, anonymize_value=EXCLUDED.anonymize_value, position=EXCLUDED.position`,
      [
        item.id, item.userId, item.agreementId, item.publicTitle, item.summary,
        item.anonymizeValue, item.position, item.createdAt,
      ],
    );
    return item;
  },

  forUser: (userId: string, db?: Executor) =>
    many(db, "SELECT * FROM showcase_items WHERE user_id = $1 ORDER BY position", [userId], mapShowcase),

  remove: (id: string, userId: string, db?: Executor) =>
    run(db, "DELETE FROM showcase_items WHERE id=$1 AND user_id=$2", [id, userId]),
};

export const analyticsRepo = {
  async insert(e: AnalyticsEvent, db?: Executor): Promise<AnalyticsEvent> {
    await run(
      db,
      `INSERT INTO analytics_events (id, name, user_id, anonymous_id, agreement_id, properties, forwarded, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [e.id, e.name, e.userId, e.anonymousId, e.agreementId, toJson(e.properties), e.forwarded, e.createdAt],
    );
    return e;
  },

  all: (db?: Executor) =>
    many(db, "SELECT * FROM analytics_events ORDER BY created_at DESC", [], (r) => ({
      id: r.id,
      name: r.name,
      userId: r.user_id,
      anonymousId: r.anonymous_id,
      agreementId: r.agreement_id,
      properties: parseJson(r.properties, {}),
      forwarded: toBool(r.forwarded),
      createdAt: r.created_at,
    })),

  async countByName(db?: Executor): Promise<Record<string, number>> {
    const rows = await many(
      db, "SELECT name, COUNT(*)::int AS c FROM analytics_events GROUP BY name", [],
      (r) => [r.name as string, toInt(r.c)] as const,
    );
    return Object.fromEntries(rows);
  },

  async uniqueActors(db?: Executor): Promise<number> {
    const r = await one(
      db,
      "SELECT COUNT(DISTINCT COALESCE(user_id, anonymous_id))::int AS c FROM analytics_events",
      [],
      (row) => toInt(row.c),
    );
    return r ?? 0;
  },
};

export const auditRepo = {
  async insert(e: AuditLogEntry, db?: Executor): Promise<AuditLogEntry> {
    await run(
      db,
      `INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, before, after, ip, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [e.id, e.actorId, e.action, e.entityType, e.entityId, toJson(e.before), toJson(e.after), e.ip, e.createdAt],
    );
    return e;
  },

  recent: (limit = 100, db?: Executor) =>
    many(db, "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1", [limit], (r) => ({
      id: r.id,
      actorId: r.actor_id,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      before: parseJson(r.before, null),
      after: parseJson(r.after, null),
      ip: r.ip,
      createdAt: r.created_at,
    })),
};

// ---------------------------------------------------------------------------
// Idempotency & rate limiting
// ---------------------------------------------------------------------------

export const idempotencyRepo = {
  /**
   * Claim a key. Returns the stored response if this key was already completed,
   * or "claimed" if the caller now owns the operation. This is what stops a
   * retried "Release payment" request from paying twice.
   *
   * The insert relies on the primary key: two concurrent claims race at the
   * database, and exactly one wins.
   */
  async claim(
    key: string,
    scope: string,
    userId: string | null,
    db?: Executor,
  ): Promise<{ status: "claimed" } | { status: "duplicate"; response: unknown } | { status: "in_flight" }> {
    const e = await exec(db);

    const inserted = await e.query(
      `INSERT INTO idempotency_keys (key, scope, user_id, status, created_at)
       VALUES ($1,$2,$3,'in_flight',$4)
       ON CONFLICT (key) DO NOTHING
       RETURNING key`,
      [key, scope, userId, nowIso()],
    );

    if (inserted.rows.length > 0) return { status: "claimed" };

    const existing = await e.query("SELECT status, response FROM idempotency_keys WHERE key = $1", [key]);
    const row = existing.rows[0];
    if (row?.status === "completed") {
      return { status: "duplicate", response: parseJson(row.response, null) };
    }
    return { status: "in_flight" };
  },

  complete: (key: string, response: unknown, db?: Executor) =>
    run(db, "UPDATE idempotency_keys SET status='completed', response=$1 WHERE key=$2", [
      toJson(response), key,
    ]),

  release: (key: string, db?: Executor) =>
    run(db, "DELETE FROM idempotency_keys WHERE key=$1 AND status='in_flight'", [key]),
};

export const rateLimitRepo = {
  /** Fixed-window counter. Returns true when the request is allowed. */
  async consume(bucket: string, limit: number, windowSeconds: number, db?: Executor): Promise<boolean> {
    const e = await exec(db);
    const now = new Date();

    // A single statement: start a new window if the old one expired, otherwise
    // increment. Doing it atomically avoids a read-modify-write race that would
    // let concurrent requests slip past the limit.
    const { rows } = await e.query(
      `INSERT INTO rate_limits (bucket, count, window_start) VALUES ($1, 1, $2)
       ON CONFLICT (bucket) DO UPDATE SET
         count = CASE
           WHEN rate_limits.window_start::timestamptz < $3::timestamptz THEN 1
           ELSE rate_limits.count + 1
         END,
         window_start = CASE
           WHEN rate_limits.window_start::timestamptz < $3::timestamptz THEN $2
           ELSE rate_limits.window_start
         END
       RETURNING count`,
      [bucket, now.toISOString(), new Date(now.getTime() - windowSeconds * 1000).toISOString()],
    );

    return toInt(rows[0]?.count, 1) <= limit;
  },
};

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchRecord {
  entityType: "agreement" | "milestone" | "payment" | "user" | "dispute";
  entityId: string;
  ownerIds: string[];
  title: string;
  subtitle: string;
  body: string;
  href: string;
  isPublic: boolean;
}

export const searchRepo = {
  upsert: (rec: SearchRecord, db?: Executor) =>
    run(
      db,
      `INSERT INTO search_index (id, entity_type, entity_id, owner_ids, title, subtitle, body, href, is_public, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (entity_type, entity_id) DO UPDATE SET owner_ids=EXCLUDED.owner_ids, title=EXCLUDED.title,
         subtitle=EXCLUDED.subtitle, body=EXCLUDED.body, href=EXCLUDED.href, is_public=EXCLUDED.is_public,
         updated_at=EXCLUDED.updated_at`,
      [
        newId("idx"), rec.entityType, rec.entityId, toJson(rec.ownerIds), rec.title,
        rec.subtitle, rec.body, rec.href, rec.isPublic, nowIso(),
      ],
    ),

  /** Results are filtered to what the viewer is allowed to see. */
  async query(term: string, viewerId: string | null, limit = 20, db?: Executor): Promise<SearchRecord[]> {
    const like = `%${term.toLowerCase()}%`;
    const rows = await many(
      db,
      `SELECT * FROM search_index
       WHERE lower(title) LIKE $1 OR lower(subtitle) LIKE $1 OR lower(body) LIKE $1
       ORDER BY updated_at DESC LIMIT $2`,
      [like, limit * 3],
      (r): SearchRecord => ({
        entityType: r.entity_type,
        entityId: r.entity_id,
        ownerIds: parseJson<string[]>(r.owner_ids, []),
        title: r.title,
        subtitle: r.subtitle,
        body: r.body,
        href: r.href,
        isPublic: toBool(r.is_public),
      }),
    );

    return rows
      .filter((r) => r.isPublic || (viewerId !== null && r.ownerIds.includes(viewerId)))
      .slice(0, limit);
  },

  remove: (entityType: string, entityId: string, db?: Executor) =>
    run(db, "DELETE FROM search_index WHERE entity_type=$1 AND entity_id=$2", [entityType, entityId]),
};
