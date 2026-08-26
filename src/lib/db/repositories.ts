/**
 * Repositories: the only place that knows SQL.
 *
 * Services above this layer work with domain objects and never see a row shape,
 * which is what makes the storage engine swappable.
 */

import type { DatabaseSync } from "node:sqlite";
import { getDb, parseJson, toJson, toBool, fromBool } from "./client";
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
  ShowcaseItem,
  User,
  WalletAddress,
} from "@/lib/domain/types";
import { DEFAULT_AGREEMENT_RULES } from "@/lib/domain/types";
import { newId, nowIso } from "@/lib/domain/ids";

type Row = Record<string, any>;

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
    totalAmount: r.total_amount,
    asset: r.asset,
    status: r.status,
    agreementHash: r.agreement_hash,
    onChainId: r.on_chain_id,
    escrowAddress: r.escrow_address,
    fundingTxHash: r.funding_tx_hash,
    chainId: r.chain_id,
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
    position: r.position,
    title: r.title,
    description: r.description,
    amount: r.amount,
    dueAt: r.due_at,
    deliverables: parseJson(r.deliverables, []),
    acceptanceCriteria: parseJson(r.acceptance_criteria, []),
    requiredEvidence: parseJson(r.required_evidence, []),
    status: r.status,
    revisionCount: r.revision_count,
    releasedAmount: r.released_amount,
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
    round: r.round,
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
    round: r.round,
    consistency: r.consistency,
    findings: parseJson(r.findings, []),
    recommendation: r.recommendation,
    confidence: r.confidence,
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
    amount: r.amount,
    asset: r.asset,
    recipientAddress: r.recipient_address,
    status: r.status,
    txHash: r.tx_hash,
    chainId: r.chain_id,
    blockNumber: r.block_number,
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
    resolvedProviderAmount: r.resolved_provider_amount,
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

// ---------------------------------------------------------------------------
// Users & wallets
// ---------------------------------------------------------------------------

export const usersRepo = {
  create(user: Omit<User, "createdAt"> & { createdAt?: string }, db: DatabaseSync = getDb()): User {
    const createdAt = user.createdAt ?? nowIso();
    db.prepare(
      `INSERT INTO users (id, handle, display_name, headline, bio, avatar_color, email, professions,
        verification, is_admin, public_profile_enabled, public_metrics, timezone, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      user.id,
      user.handle,
      user.displayName,
      user.headline,
      user.bio,
      user.avatarColor,
      user.email,
      toJson(user.professions),
      user.verification,
      fromBool(user.isAdmin),
      fromBool(user.publicProfileEnabled),
      toJson(user.publicMetrics),
      user.timezone,
      createdAt,
    );
    return { ...user, createdAt };
  },

  byId(id: string, db: DatabaseSync = getDb()): User | null {
    const r = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Row | undefined;
    return r ? mapUser(r) : null;
  },

  byHandle(handle: string, db: DatabaseSync = getDb()): User | null {
    const r = db.prepare("SELECT * FROM users WHERE handle = ?").get(handle) as Row | undefined;
    return r ? mapUser(r) : null;
  },

  byAddress(address: string, db: DatabaseSync = getDb()): User | null {
    const r = db
      .prepare(
        `SELECT u.* FROM users u
         JOIN wallet_addresses w ON w.user_id = u.id
         WHERE lower(w.address) = lower(?) LIMIT 1`,
      )
      .get(address) as Row | undefined;
    return r ? mapUser(r) : null;
  },

  all(db: DatabaseSync = getDb()): User[] {
    return (db.prepare("SELECT * FROM users ORDER BY created_at").all() as Row[]).map(mapUser);
  },

  updateProfile(
    id: string,
    patch: Partial<Pick<User, "displayName" | "headline" | "bio" | "professions" | "timezone">>,
    db: DatabaseSync = getDb(),
  ): void {
    const current = usersRepo.byId(id, db);
    if (!current) return;
    db.prepare(
      `UPDATE users SET display_name=?, headline=?, bio=?, professions=?, timezone=? WHERE id=?`,
    ).run(
      patch.displayName ?? current.displayName,
      patch.headline ?? current.headline,
      patch.bio ?? current.bio,
      toJson(patch.professions ?? current.professions),
      patch.timezone ?? current.timezone,
      id,
    );
  },

  updatePrivacy(
    id: string,
    publicProfileEnabled: boolean,
    publicMetrics: string[],
    db: DatabaseSync = getDb(),
  ): void {
    db.prepare(
      "UPDATE users SET public_profile_enabled=?, public_metrics=? WHERE id=?",
    ).run(fromBool(publicProfileEnabled), toJson(publicMetrics), id);
  },
};

export const walletsRepo = {
  add(w: Omit<WalletAddress, "id" | "createdAt">, db: DatabaseSync = getDb()): WalletAddress {
    const record: WalletAddress = { ...w, id: newId("wal"), createdAt: nowIso() };
    db.prepare(
      `INSERT INTO wallet_addresses (id, user_id, address, chain_id, label, is_primary, verified_at, created_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(address, chain_id) DO UPDATE SET user_id=excluded.user_id, verified_at=excluded.verified_at`,
    ).run(
      record.id,
      record.userId,
      record.address.toLowerCase(),
      record.chainId,
      record.label,
      fromBool(record.isPrimary),
      record.verifiedAt,
      record.createdAt,
    );
    return record;
  },

  forUser(userId: string, db: DatabaseSync = getDb()): WalletAddress[] {
    return (
      db
        .prepare("SELECT * FROM wallet_addresses WHERE user_id = ? ORDER BY is_primary DESC, created_at")
        .all(userId) as Row[]
    ).map((r) => ({
      id: r.id,
      userId: r.user_id,
      address: r.address,
      chainId: r.chain_id,
      label: r.label,
      isPrimary: toBool(r.is_primary),
      verifiedAt: r.verified_at,
      createdAt: r.created_at,
    }));
  },

  primaryAddress(userId: string, db: DatabaseSync = getDb()): string | null {
    const r = db
      .prepare(
        "SELECT address FROM wallet_addresses WHERE user_id = ? ORDER BY is_primary DESC, created_at LIMIT 1",
      )
      .get(userId) as Row | undefined;
    return r?.address ?? null;
  },

  remove(id: string, userId: string, db: DatabaseSync = getDb()): void {
    db.prepare("DELETE FROM wallet_addresses WHERE id = ? AND user_id = ?").run(id, userId);
  },
};

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const sessionsRepo = {
  create(userId: string, address: string, chainId: number, ttlHours = 24 * 14, db: DatabaseSync = getDb()) {
    const id = newId("ses");
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + ttlHours * 3_600_000).toISOString();
    db.prepare(
      "INSERT INTO sessions (id, user_id, address, chain_id, created_at, expires_at) VALUES (?,?,?,?,?,?)",
    ).run(id, userId, address.toLowerCase(), chainId, createdAt, expiresAt);
    return { id, userId, address, chainId, createdAt, expiresAt };
  },

  byId(id: string, db: DatabaseSync = getDb()) {
    const r = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Row | undefined;
    if (!r) return null;
    if (Date.parse(r.expires_at) < Date.now()) return null;
    return { id: r.id, userId: r.user_id, address: r.address, chainId: r.chain_id, expiresAt: r.expires_at };
  },

  destroy(id: string, db: DatabaseSync = getDb()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  },
};

// ---------------------------------------------------------------------------
// Agreements & milestones
// ---------------------------------------------------------------------------

export const agreementsRepo = {
  insert(a: Agreement, db: DatabaseSync = getDb()): Agreement {
    db.prepare(
      `INSERT INTO agreements (id, reference, title, description, client_id, provider_id,
        provider_invite_address, total_amount, asset, status, agreement_hash, on_chain_id,
        escrow_address, funding_tx_hash, chain_id, rules, client_signature, provider_signature,
        expected_completion_at, started_at, completed_at, cancelled_at, is_simulated, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      a.id, a.reference, a.title, a.description, a.clientId, a.providerId,
      a.providerInviteAddress, a.totalAmount, a.asset, a.status, a.agreementHash, a.onChainId,
      a.escrowAddress, a.fundingTxHash, a.chainId, toJson(a.rules), toJson(a.clientSignature),
      toJson(a.providerSignature), a.expectedCompletionAt, a.startedAt, a.completedAt,
      a.cancelledAt, fromBool(a.isSimulated), a.createdAt, a.updatedAt,
    );
    return a;
  },

  update(a: Agreement, db: DatabaseSync = getDb()): Agreement {
    const updated = { ...a, updatedAt: nowIso() };
    db.prepare(
      `UPDATE agreements SET title=?, description=?, provider_id=?, provider_invite_address=?,
        total_amount=?, asset=?, status=?, agreement_hash=?, on_chain_id=?, escrow_address=?,
        funding_tx_hash=?, chain_id=?, rules=?, client_signature=?, provider_signature=?,
        expected_completion_at=?, started_at=?, completed_at=?, cancelled_at=?, is_simulated=?, updated_at=?
       WHERE id=?`,
    ).run(
      updated.title, updated.description, updated.providerId, updated.providerInviteAddress,
      updated.totalAmount, updated.asset, updated.status, updated.agreementHash, updated.onChainId,
      updated.escrowAddress, updated.fundingTxHash, updated.chainId, toJson(updated.rules),
      toJson(updated.clientSignature), toJson(updated.providerSignature), updated.expectedCompletionAt,
      updated.startedAt, updated.completedAt, updated.cancelledAt, fromBool(updated.isSimulated),
      updated.updatedAt, updated.id,
    );
    return updated;
  },

  byId(id: string, db: DatabaseSync = getDb()): Agreement | null {
    const r = db.prepare("SELECT * FROM agreements WHERE id = ?").get(id) as Row | undefined;
    return r ? mapAgreement(r) : null;
  },

  byReference(reference: string, db: DatabaseSync = getDb()): Agreement | null {
    const r = db.prepare("SELECT * FROM agreements WHERE reference = ?").get(reference) as Row | undefined;
    return r ? mapAgreement(r) : null;
  },

  forUser(userId: string, db: DatabaseSync = getDb()): Agreement[] {
    return (
      db
        .prepare(
          "SELECT * FROM agreements WHERE client_id = ? OR provider_id = ? ORDER BY updated_at DESC",
        )
        .all(userId, userId) as Row[]
    ).map(mapAgreement);
  },

  all(db: DatabaseSync = getDb()): Agreement[] {
    return (db.prepare("SELECT * FROM agreements ORDER BY created_at DESC").all() as Row[]).map(
      mapAgreement,
    );
  },

  nextSequence(db: DatabaseSync = getDb()): number {
    const r = db.prepare("SELECT COUNT(*) as c FROM agreements").get() as Row;
    return (r?.c ?? 0) + 1;
  },
};

export const milestonesRepo = {
  insert(m: Milestone, db: DatabaseSync = getDb()): Milestone {
    db.prepare(
      `INSERT INTO milestones (id, agreement_id, position, title, description, amount, due_at,
        deliverables, acceptance_criteria, required_evidence, status, revision_count,
        released_amount, submitted_at, approved_at, released_at, review_due_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      m.id, m.agreementId, m.position, m.title, m.description, m.amount, m.dueAt,
      toJson(m.deliverables), toJson(m.acceptanceCriteria), toJson(m.requiredEvidence),
      m.status, m.revisionCount, m.releasedAmount, m.submittedAt, m.approvedAt, m.releasedAt,
      m.reviewDueAt, m.createdAt, m.updatedAt,
    );
    return m;
  },

  update(m: Milestone, db: DatabaseSync = getDb()): Milestone {
    const updated = { ...m, updatedAt: nowIso() };
    db.prepare(
      `UPDATE milestones SET position=?, title=?, description=?, amount=?, due_at=?, deliverables=?,
        acceptance_criteria=?, required_evidence=?, status=?, revision_count=?, released_amount=?,
        submitted_at=?, approved_at=?, released_at=?, review_due_at=?, updated_at=?
       WHERE id=?`,
    ).run(
      updated.position, updated.title, updated.description, updated.amount, updated.dueAt,
      toJson(updated.deliverables), toJson(updated.acceptanceCriteria), toJson(updated.requiredEvidence),
      updated.status, updated.revisionCount, updated.releasedAmount, updated.submittedAt,
      updated.approvedAt, updated.releasedAt, updated.reviewDueAt, updated.updatedAt, updated.id,
    );
    return updated;
  },

  byId(id: string, db: DatabaseSync = getDb()): Milestone | null {
    const r = db.prepare("SELECT * FROM milestones WHERE id = ?").get(id) as Row | undefined;
    return r ? mapMilestone(r) : null;
  },

  forAgreement(agreementId: string, db: DatabaseSync = getDb()): Milestone[] {
    return (
      db.prepare("SELECT * FROM milestones WHERE agreement_id = ? ORDER BY position").all(agreementId) as Row[]
    ).map(mapMilestone);
  },

  deleteForAgreement(agreementId: string, db: DatabaseSync = getDb()): void {
    db.prepare("DELETE FROM milestones WHERE agreement_id = ?").run(agreementId);
  },

  all(db: DatabaseSync = getDb()): Milestone[] {
    return (db.prepare("SELECT * FROM milestones").all() as Row[]).map(mapMilestone);
  },
};

// ---------------------------------------------------------------------------
// Evidence & analysis
// ---------------------------------------------------------------------------

export const evidenceRepo = {
  insert(e: Evidence, db: DatabaseSync = getDb()): Evidence {
    db.prepare(
      `INSERT INTO evidence (id, milestone_id, agreement_id, submitted_by, round, kind, title,
        source, description, metadata, hash, submitted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      e.id, e.milestoneId, e.agreementId, e.submittedBy, e.round, e.kind, e.title,
      e.source, e.description, toJson(e.metadata), e.hash, e.submittedAt,
    );
    return e;
  },

  forMilestone(milestoneId: string, db: DatabaseSync = getDb()): Evidence[] {
    return (
      db.prepare("SELECT * FROM evidence WHERE milestone_id = ? ORDER BY submitted_at").all(milestoneId) as Row[]
    ).map(mapEvidence);
  },

  forMilestoneRound(milestoneId: string, round: number, db: DatabaseSync = getDb()): Evidence[] {
    return (
      db
        .prepare("SELECT * FROM evidence WHERE milestone_id = ? AND round = ? ORDER BY submitted_at")
        .all(milestoneId, round) as Row[]
    ).map(mapEvidence);
  },

  countForAgreement(agreementId: string, db: DatabaseSync = getDb()): number {
    const r = db.prepare("SELECT COUNT(*) c FROM evidence WHERE agreement_id = ?").get(agreementId) as Row;
    return r?.c ?? 0;
  },
};

export const analysisRepo = {
  insert(a: EvidenceAnalysis, db: DatabaseSync = getDb()): EvidenceAnalysis {
    db.prepare(
      `INSERT INTO evidence_analyses (id, milestone_id, agreement_id, round, consistency, findings,
        recommendation, confidence, summary, open_questions, engine, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      a.id, a.milestoneId, a.agreementId, a.round, a.consistency, toJson(a.findings),
      a.recommendation, a.confidence, a.summary, toJson(a.openQuestions), a.engine, a.createdAt,
    );
    return a;
  },

  latestForMilestone(milestoneId: string, db: DatabaseSync = getDb()): EvidenceAnalysis | null {
    const r = db
      .prepare("SELECT * FROM evidence_analyses WHERE milestone_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(milestoneId) as Row | undefined;
    return r ? mapAnalysis(r) : null;
  },
};

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const paymentsRepo = {
  insert(p: Payment, db: DatabaseSync = getDb()): Payment {
    db.prepare(
      `INSERT INTO payments (id, agreement_id, milestone_id, kind, amount, asset, recipient_address,
        status, tx_hash, chain_id, block_number, idempotency_key, reason, failure_reason,
        is_simulated, initiated_by, created_at, confirmed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      p.id, p.agreementId, p.milestoneId, p.kind, p.amount, p.asset, p.recipientAddress,
      p.status, p.txHash, p.chainId, p.blockNumber, p.idempotencyKey, p.reason, p.failureReason,
      fromBool(p.isSimulated), p.initiatedBy, p.createdAt, p.confirmedAt,
    );
    return p;
  },

  update(p: Payment, db: DatabaseSync = getDb()): Payment {
    db.prepare(
      `UPDATE payments SET status=?, tx_hash=?, chain_id=?, block_number=?, failure_reason=?, confirmed_at=?
       WHERE id=?`,
    ).run(p.status, p.txHash, p.chainId, p.blockNumber, p.failureReason, p.confirmedAt, p.id);
    return p;
  },

  byId(id: string, db: DatabaseSync = getDb()): Payment | null {
    const r = db.prepare("SELECT * FROM payments WHERE id = ?").get(id) as Row | undefined;
    return r ? mapPayment(r) : null;
  },

  byIdempotencyKey(key: string, db: DatabaseSync = getDb()): Payment | null {
    const r = db.prepare("SELECT * FROM payments WHERE idempotency_key = ?").get(key) as Row | undefined;
    return r ? mapPayment(r) : null;
  },

  byTxHash(hash: string, db: DatabaseSync = getDb()): Payment | null {
    const r = db.prepare("SELECT * FROM payments WHERE tx_hash = ?").get(hash) as Row | undefined;
    return r ? mapPayment(r) : null;
  },

  forAgreement(agreementId: string, db: DatabaseSync = getDb()): Payment[] {
    return (
      db.prepare("SELECT * FROM payments WHERE agreement_id = ? ORDER BY created_at").all(agreementId) as Row[]
    ).map(mapPayment);
  },

  forMilestone(milestoneId: string, db: DatabaseSync = getDb()): Payment[] {
    return (
      db.prepare("SELECT * FROM payments WHERE milestone_id = ? ORDER BY created_at").all(milestoneId) as Row[]
    ).map(mapPayment);
  },

  all(db: DatabaseSync = getDb()): Payment[] {
    return (db.prepare("SELECT * FROM payments ORDER BY created_at DESC").all() as Row[]).map(mapPayment);
  },

  /** Total confirmed value released for a milestone. The ledger is the source of truth. */
  confirmedTotalForMilestone(milestoneId: string, db: DatabaseSync = getDb()): number {
    const r = db
      .prepare(
        `SELECT IFNULL(SUM(amount),0) t FROM payments
         WHERE milestone_id = ? AND status = 'confirmed' AND kind <> 'refund'`,
      )
      .get(milestoneId) as Row;
    return r?.t ?? 0;
  },
};

// ---------------------------------------------------------------------------
// Revisions, disputes
// ---------------------------------------------------------------------------

export const revisionsRepo = {
  insert(r: import("@/lib/domain/types").RevisionRequest, db: DatabaseSync = getDb()) {
    db.prepare(
      `INSERT INTO revision_requests (id, agreement_id, milestone_id, requested_by, round, issue,
        requested_action, unmet_criterion_ids, resolved_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      r.id, r.agreementId, r.milestoneId, r.requestedBy, r.round, r.issue,
      r.requestedAction, toJson(r.unmetCriterionIds), r.resolvedAt, r.createdAt,
    );
    return r;
  },

  forMilestone(milestoneId: string, db: DatabaseSync = getDb()) {
    return (
      db
        .prepare("SELECT * FROM revision_requests WHERE milestone_id = ? ORDER BY created_at")
        .all(milestoneId) as Row[]
    ).map((r) => ({
      id: r.id,
      agreementId: r.agreement_id,
      milestoneId: r.milestone_id,
      requestedBy: r.requested_by,
      round: r.round,
      issue: r.issue,
      requestedAction: r.requested_action,
      unmetCriterionIds: parseJson<string[]>(r.unmet_criterion_ids, []),
      resolvedAt: r.resolved_at,
      createdAt: r.created_at,
    }));
  },

  resolveOpen(milestoneId: string, db: DatabaseSync = getDb()) {
    db.prepare(
      "UPDATE revision_requests SET resolved_at = ? WHERE milestone_id = ? AND resolved_at IS NULL",
    ).run(nowIso(), milestoneId);
  },
};

export const disputesRepo = {
  insert(d: Dispute, db: DatabaseSync = getDb()): Dispute {
    db.prepare(
      `INSERT INTO disputes (id, agreement_id, milestone_id, opened_by, reason, detail, status,
        resolution, resolution_note, resolved_provider_amount, resolved_by_user_id, opened_at, resolved_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      d.id, d.agreementId, d.milestoneId, d.openedBy, d.reason, d.detail, d.status,
      d.resolution, d.resolutionNote, d.resolvedProviderAmount, d.resolvedByUserId, d.openedAt, d.resolvedAt,
    );
    return d;
  },

  update(d: Dispute, db: DatabaseSync = getDb()): Dispute {
    db.prepare(
      `UPDATE disputes SET status=?, resolution=?, resolution_note=?, resolved_provider_amount=?,
        resolved_by_user_id=?, resolved_at=? WHERE id=?`,
    ).run(d.status, d.resolution, d.resolutionNote, d.resolvedProviderAmount, d.resolvedByUserId, d.resolvedAt, d.id);
    return d;
  },

  byId(id: string, db: DatabaseSync = getDb()): Dispute | null {
    const r = db.prepare("SELECT * FROM disputes WHERE id = ?").get(id) as Row | undefined;
    return r ? mapDispute(r) : null;
  },

  forMilestone(milestoneId: string, db: DatabaseSync = getDb()): Dispute | null {
    const r = db
      .prepare("SELECT * FROM disputes WHERE milestone_id = ? ORDER BY opened_at DESC LIMIT 1")
      .get(milestoneId) as Row | undefined;
    return r ? mapDispute(r) : null;
  },

  forAgreement(agreementId: string, db: DatabaseSync = getDb()): Dispute[] {
    return (
      db.prepare("SELECT * FROM disputes WHERE agreement_id = ? ORDER BY opened_at DESC").all(agreementId) as Row[]
    ).map(mapDispute);
  },

  all(db: DatabaseSync = getDb()): Dispute[] {
    return (db.prepare("SELECT * FROM disputes ORDER BY opened_at DESC").all() as Row[]).map(mapDispute);
  },

  addMessage(m: DisputeMessage, db: DatabaseSync = getDb()): DisputeMessage {
    db.prepare(
      "INSERT INTO dispute_messages (id, dispute_id, author_id, body, created_at) VALUES (?,?,?,?,?)",
    ).run(m.id, m.disputeId, m.authorId, m.body, m.createdAt);
    return m;
  },

  messages(disputeId: string, db: DatabaseSync = getDb()): DisputeMessage[] {
    return (
      db.prepare("SELECT * FROM dispute_messages WHERE dispute_id = ? ORDER BY created_at").all(disputeId) as Row[]
    ).map((r) => ({
      id: r.id,
      disputeId: r.dispute_id,
      authorId: r.author_id,
      body: r.body,
      createdAt: r.created_at,
    }));
  },
};

// ---------------------------------------------------------------------------
// Activity, notifications, showcase, analytics, audit
// ---------------------------------------------------------------------------

export const activityRepo = {
  insert(e: ActivityEvent, db: DatabaseSync = getDb()): ActivityEvent {
    db.prepare(
      `INSERT INTO activity_events (id, agreement_id, milestone_id, actor_id, actor_label, type,
        summary, metadata, tx_hash, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      e.id, e.agreementId, e.milestoneId, e.actorId, e.actorLabel, e.type,
      e.summary, toJson(e.metadata), e.txHash, e.createdAt,
    );
    return e;
  },

  forAgreement(agreementId: string, db: DatabaseSync = getDb()): ActivityEvent[] {
    return (
      db
        .prepare("SELECT * FROM activity_events WHERE agreement_id = ? ORDER BY created_at DESC")
        .all(agreementId) as Row[]
    ).map(mapActivity);
  },

  recent(limit = 50, db: DatabaseSync = getDb()): ActivityEvent[] {
    return (
      db.prepare("SELECT * FROM activity_events ORDER BY created_at DESC LIMIT ?").all(limit) as Row[]
    ).map(mapActivity);
  },
};

export const notificationsRepo = {
  insert(n: Notification, db: DatabaseSync = getDb()): Notification {
    db.prepare(
      `INSERT INTO notifications (id, user_id, kind, title, body, href, agreement_id, read_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(n.id, n.userId, n.kind, n.title, n.body, n.href, n.agreementId, n.readAt, n.createdAt);
    return n;
  },

  forUser(userId: string, limit = 50, db: DatabaseSync = getDb()): Notification[] {
    return (
      db
        .prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
        .all(userId, limit) as Row[]
    ).map(mapNotification);
  },

  unreadCount(userId: string, db: DatabaseSync = getDb()): number {
    const r = db
      .prepare("SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read_at IS NULL")
      .get(userId) as Row;
    return r?.c ?? 0;
  },

  markRead(userId: string, ids: string[] | null, db: DatabaseSync = getDb()): void {
    const at = nowIso();
    if (!ids || ids.length === 0) {
      db.prepare("UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL").run(at, userId);
      return;
    }
    const stmt = db.prepare("UPDATE notifications SET read_at=? WHERE id=? AND user_id=?");
    for (const id of ids) stmt.run(at, id, userId);
  },

  preferences(userId: string, db: DatabaseSync = getDb()): NotificationPreferences {
    const r = db.prepare("SELECT * FROM notification_preferences WHERE user_id = ?").get(userId) as Row | undefined;
    return {
      userId,
      channels: parseJson(r?.channels, {} as NotificationPreferences["channels"]),
      digestMode: toBool(r?.digest_mode),
    };
  },

  savePreferences(prefs: NotificationPreferences, db: DatabaseSync = getDb()): void {
    db.prepare(
      `INSERT INTO notification_preferences (user_id, channels, digest_mode) VALUES (?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET channels=excluded.channels, digest_mode=excluded.digest_mode`,
    ).run(prefs.userId, toJson(prefs.channels), fromBool(prefs.digestMode));
  },
};

export const showcaseRepo = {
  upsert(item: ShowcaseItem, db: DatabaseSync = getDb()): ShowcaseItem {
    db.prepare(
      `INSERT INTO showcase_items (id, user_id, agreement_id, public_title, summary, anonymize_value, position, created_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id, agreement_id) DO UPDATE SET public_title=excluded.public_title,
         summary=excluded.summary, anonymize_value=excluded.anonymize_value, position=excluded.position`,
    ).run(
      item.id, item.userId, item.agreementId, item.publicTitle, item.summary,
      fromBool(item.anonymizeValue), item.position, item.createdAt,
    );
    return item;
  },

  forUser(userId: string, db: DatabaseSync = getDb()): ShowcaseItem[] {
    return (
      db.prepare("SELECT * FROM showcase_items WHERE user_id = ? ORDER BY position").all(userId) as Row[]
    ).map((r) => ({
      id: r.id,
      userId: r.user_id,
      agreementId: r.agreement_id,
      publicTitle: r.public_title,
      summary: r.summary,
      anonymizeValue: toBool(r.anonymize_value),
      position: r.position,
      createdAt: r.created_at,
    }));
  },

  remove(id: string, userId: string, db: DatabaseSync = getDb()): void {
    db.prepare("DELETE FROM showcase_items WHERE id=? AND user_id=?").run(id, userId);
  },
};

export const analyticsRepo = {
  insert(e: AnalyticsEvent, db: DatabaseSync = getDb()): AnalyticsEvent {
    db.prepare(
      `INSERT INTO analytics_events (id, name, user_id, anonymous_id, agreement_id, properties, forwarded, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(e.id, e.name, e.userId, e.anonymousId, e.agreementId, toJson(e.properties), fromBool(e.forwarded), e.createdAt);
    return e;
  },

  all(db: DatabaseSync = getDb()): AnalyticsEvent[] {
    return (db.prepare("SELECT * FROM analytics_events ORDER BY created_at DESC").all() as Row[]).map((r) => ({
      id: r.id,
      name: r.name,
      userId: r.user_id,
      anonymousId: r.anonymous_id,
      agreementId: r.agreement_id,
      properties: parseJson(r.properties, {}),
      forwarded: toBool(r.forwarded),
      createdAt: r.created_at,
    }));
  },

  countByName(db: DatabaseSync = getDb()): Record<string, number> {
    const rows = db.prepare("SELECT name, COUNT(*) c FROM analytics_events GROUP BY name").all() as Row[];
    return Object.fromEntries(rows.map((r) => [r.name, r.c]));
  },

  uniqueActors(db: DatabaseSync = getDb()): number {
    const r = db
      .prepare("SELECT COUNT(DISTINCT IFNULL(user_id, anonymous_id)) c FROM analytics_events")
      .get() as Row;
    return r?.c ?? 0;
  },
};

export const auditRepo = {
  insert(e: AuditLogEntry, db: DatabaseSync = getDb()): AuditLogEntry {
    db.prepare(
      `INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, before, after, ip, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(e.id, e.actorId, e.action, e.entityType, e.entityId, toJson(e.before), toJson(e.after), e.ip, e.createdAt);
    return e;
  },

  recent(limit = 100, db: DatabaseSync = getDb()): AuditLogEntry[] {
    return (db.prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?").all(limit) as Row[]).map((r) => ({
      id: r.id,
      actorId: r.actor_id,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      before: parseJson(r.before, null),
      after: parseJson(r.after, null),
      ip: r.ip,
      createdAt: r.created_at,
    }));
  },
};

// ---------------------------------------------------------------------------
// Idempotency & rate limiting
// ---------------------------------------------------------------------------

export const idempotencyRepo = {
  /**
   * Claim a key. Returns the stored response if this key was already completed,
   * or null if the caller now owns the operation. This is what stops a retried
   * "Release payment" request from paying twice.
   */
  claim(key: string, scope: string, userId: string | null, db: DatabaseSync = getDb()):
    | { status: "claimed" }
    | { status: "duplicate"; response: unknown }
    | { status: "in_flight" } {
    const existing = db.prepare("SELECT * FROM idempotency_keys WHERE key = ?").get(key) as Row | undefined;
    if (existing) {
      if (existing.status === "completed") {
        return { status: "duplicate", response: parseJson(existing.response, null) };
      }
      return { status: "in_flight" };
    }
    db.prepare(
      "INSERT INTO idempotency_keys (key, scope, user_id, status, created_at) VALUES (?,?,?,'in_flight',?)",
    ).run(key, scope, userId, nowIso());
    return { status: "claimed" };
  },

  complete(key: string, response: unknown, db: DatabaseSync = getDb()): void {
    db.prepare("UPDATE idempotency_keys SET status='completed', response=? WHERE key=?").run(
      toJson(response),
      key,
    );
  },

  release(key: string, db: DatabaseSync = getDb()): void {
    db.prepare("DELETE FROM idempotency_keys WHERE key=? AND status='in_flight'").run(key);
  },
};

export const rateLimitRepo = {
  /** Fixed-window counter. Returns true when the request is allowed. */
  consume(bucket: string, limit: number, windowSeconds: number, db: DatabaseSync = getDb()): boolean {
    const now = Date.now();
    const row = db.prepare("SELECT * FROM rate_limits WHERE bucket = ?").get(bucket) as Row | undefined;
    if (!row || now - Date.parse(row.window_start) > windowSeconds * 1000) {
      db.prepare(
        `INSERT INTO rate_limits (bucket, count, window_start) VALUES (?,1,?)
         ON CONFLICT(bucket) DO UPDATE SET count=1, window_start=excluded.window_start`,
      ).run(bucket, new Date(now).toISOString());
      return true;
    }
    if (row.count >= limit) return false;
    db.prepare("UPDATE rate_limits SET count = count + 1 WHERE bucket = ?").run(bucket);
    return true;
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
  upsert(rec: SearchRecord, db: DatabaseSync = getDb()): void {
    db.prepare(
      `INSERT INTO search_index (id, entity_type, entity_id, owner_ids, title, subtitle, body, href, is_public, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(entity_type, entity_id) DO UPDATE SET owner_ids=excluded.owner_ids, title=excluded.title,
         subtitle=excluded.subtitle, body=excluded.body, href=excluded.href, is_public=excluded.is_public,
         updated_at=excluded.updated_at`,
    ).run(
      newId("idx"), rec.entityType, rec.entityId, toJson(rec.ownerIds), rec.title,
      rec.subtitle, rec.body, rec.href, fromBool(rec.isPublic), nowIso(),
    );
  },

  /** Results are filtered to what the viewer is allowed to see. */
  query(term: string, viewerId: string | null, limit = 20, db: DatabaseSync = getDb()): SearchRecord[] {
    const like = `%${term.toLowerCase()}%`;
    const rows = db
      .prepare(
        `SELECT * FROM search_index
         WHERE lower(title) LIKE ? OR lower(subtitle) LIKE ? OR lower(body) LIKE ?
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(like, like, like, limit * 3) as Row[];

    return rows
      .map((r) => ({
        entityType: r.entity_type,
        entityId: r.entity_id,
        ownerIds: parseJson<string[]>(r.owner_ids, []),
        title: r.title,
        subtitle: r.subtitle,
        body: r.body,
        href: r.href,
        isPublic: toBool(r.is_public),
      }))
      .filter((r) => r.isPublic || (viewerId !== null && r.ownerIds.includes(viewerId)))
      .slice(0, limit);
  },

  remove(entityType: string, entityId: string, db: DatabaseSync = getDb()): void {
    db.prepare("DELETE FROM search_index WHERE entity_type=? AND entity_id=?").run(entityType, entityId);
  },
};
