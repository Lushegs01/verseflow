/**
 * Schema migrations, applied in order and recorded in `_migrations`.
 *
 * Migrations are append-only: never edit one that has shipped, add a new one.
 * Money columns are INTEGER minor units throughout -- no REAL, ever.
 */

export interface Migration {
  name: string;
  up: string;
}

export const MIGRATIONS: Migration[] = [
  {
    name: "0001_core",
    up: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        handle TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        headline TEXT NOT NULL DEFAULT '',
        bio TEXT NOT NULL DEFAULT '',
        avatar_color TEXT NOT NULL DEFAULT '#1D5BFF',
        email TEXT,
        professions TEXT NOT NULL DEFAULT '[]',
        verification TEXT NOT NULL DEFAULT 'unverified',
        is_admin INTEGER NOT NULL DEFAULT 0,
        public_profile_enabled INTEGER NOT NULL DEFAULT 0,
        public_metrics TEXT NOT NULL DEFAULT '[]',
        timezone TEXT NOT NULL DEFAULT 'UTC',
        created_at TEXT NOT NULL
      );

      CREATE TABLE wallet_addresses (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        address TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        label TEXT NOT NULL DEFAULT 'Wallet',
        is_primary INTEGER NOT NULL DEFAULT 0,
        verified_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (address, chain_id)
      );
      CREATE INDEX idx_wallets_user ON wallet_addresses(user_id);

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        address TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);

      CREATE TABLE agreements (
        id TEXT PRIMARY KEY,
        reference TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        client_id TEXT NOT NULL REFERENCES users(id),
        provider_id TEXT REFERENCES users(id),
        provider_invite_address TEXT,
        total_amount INTEGER NOT NULL,
        asset TEXT NOT NULL,
        status TEXT NOT NULL,
        agreement_hash TEXT,
        on_chain_id TEXT,
        escrow_address TEXT,
        funding_tx_hash TEXT,
        chain_id INTEGER,
        rules TEXT NOT NULL,
        client_signature TEXT,
        provider_signature TEXT,
        expected_completion_at TEXT,
        started_at TEXT,
        completed_at TEXT,
        cancelled_at TEXT,
        is_simulated INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_agreements_client ON agreements(client_id);
      CREATE INDEX idx_agreements_provider ON agreements(provider_id);
      CREATE INDEX idx_agreements_status ON agreements(status);

      CREATE TABLE milestones (
        id TEXT PRIMARY KEY,
        agreement_id TEXT NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        amount INTEGER NOT NULL,
        due_at TEXT,
        deliverables TEXT NOT NULL DEFAULT '[]',
        acceptance_criteria TEXT NOT NULL DEFAULT '[]',
        required_evidence TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'locked',
        revision_count INTEGER NOT NULL DEFAULT 0,
        released_amount INTEGER NOT NULL DEFAULT 0,
        submitted_at TEXT,
        approved_at TEXT,
        released_at TEXT,
        review_due_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_milestones_agreement ON milestones(agreement_id, position);
      CREATE INDEX idx_milestones_status ON milestones(status);

      CREATE TABLE evidence (
        id TEXT PRIMARY KEY,
        milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
        agreement_id TEXT NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
        submitted_by TEXT NOT NULL REFERENCES users(id),
        round INTEGER NOT NULL DEFAULT 1,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        hash TEXT NOT NULL,
        submitted_at TEXT NOT NULL
      );
      CREATE INDEX idx_evidence_milestone ON evidence(milestone_id, round);

      CREATE TABLE evidence_analyses (
        id TEXT PRIMARY KEY,
        milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
        agreement_id TEXT NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
        round INTEGER NOT NULL DEFAULT 1,
        consistency TEXT NOT NULL,
        findings TEXT NOT NULL DEFAULT '[]',
        recommendation TEXT NOT NULL,
        confidence INTEGER NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        open_questions TEXT NOT NULL DEFAULT '[]',
        engine TEXT NOT NULL DEFAULT 'rules',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_analyses_milestone ON evidence_analyses(milestone_id, round);

      CREATE TABLE payments (
        id TEXT PRIMARY KEY,
        agreement_id TEXT NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
        milestone_id TEXT REFERENCES milestones(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        amount INTEGER NOT NULL,
        asset TEXT NOT NULL,
        recipient_address TEXT NOT NULL,
        status TEXT NOT NULL,
        tx_hash TEXT,
        chain_id INTEGER,
        block_number INTEGER,
        idempotency_key TEXT NOT NULL UNIQUE,
        reason TEXT,
        failure_reason TEXT,
        is_simulated INTEGER NOT NULL DEFAULT 1,
        initiated_by TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        confirmed_at TEXT
      );
      CREATE INDEX idx_payments_agreement ON payments(agreement_id);
      CREATE INDEX idx_payments_milestone ON payments(milestone_id);
      CREATE INDEX idx_payments_tx ON payments(tx_hash);

      CREATE TABLE revision_requests (
        id TEXT PRIMARY KEY,
        agreement_id TEXT NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
        milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
        requested_by TEXT NOT NULL REFERENCES users(id),
        round INTEGER NOT NULL,
        issue TEXT NOT NULL,
        requested_action TEXT NOT NULL,
        unmet_criterion_ids TEXT NOT NULL DEFAULT '[]',
        resolved_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_revisions_milestone ON revision_requests(milestone_id);

      CREATE TABLE disputes (
        id TEXT PRIMARY KEY,
        agreement_id TEXT NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
        milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
        opened_by TEXT NOT NULL REFERENCES users(id),
        reason TEXT NOT NULL,
        detail TEXT NOT NULL,
        status TEXT NOT NULL,
        resolution TEXT,
        resolution_note TEXT,
        resolved_provider_amount INTEGER,
        resolved_by_user_id TEXT REFERENCES users(id),
        opened_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE INDEX idx_disputes_agreement ON disputes(agreement_id);
      CREATE INDEX idx_disputes_status ON disputes(status);

      CREATE TABLE dispute_messages (
        id TEXT PRIMARY KEY,
        dispute_id TEXT NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL REFERENCES users(id),
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_dispute_messages ON dispute_messages(dispute_id);

      CREATE TABLE activity_events (
        id TEXT PRIMARY KEY,
        agreement_id TEXT REFERENCES agreements(id) ON DELETE CASCADE,
        milestone_id TEXT REFERENCES milestones(id) ON DELETE CASCADE,
        actor_id TEXT REFERENCES users(id),
        actor_label TEXT NOT NULL,
        type TEXT NOT NULL,
        summary TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        tx_hash TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_activity_agreement ON activity_events(agreement_id, created_at);

      CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        href TEXT,
        agreement_id TEXT REFERENCES agreements(id) ON DELETE CASCADE,
        read_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_notifications_user ON notifications(user_id, created_at);

      CREATE TABLE notification_preferences (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        channels TEXT NOT NULL DEFAULT '{}',
        digest_mode INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE showcase_items (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        agreement_id TEXT NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
        public_title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        anonymize_value INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE (user_id, agreement_id)
      );

      CREATE TABLE analytics_events (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        anonymous_id TEXT NOT NULL,
        agreement_id TEXT,
        properties TEXT NOT NULL DEFAULT '{}',
        forwarded INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_analytics_name ON analytics_events(name, created_at);

      CREATE TABLE audit_log (
        id TEXT PRIMARY KEY,
        actor_id TEXT REFERENCES users(id),
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        before TEXT,
        after TEXT,
        ip TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);

      CREATE TABLE idempotency_keys (
        key TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        user_id TEXT,
        response TEXT,
        status TEXT NOT NULL DEFAULT 'in_flight',
        created_at TEXT NOT NULL
      );

      CREATE TABLE rate_limits (
        bucket TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0,
        window_start TEXT NOT NULL
      );
    `,
  },
  {
    name: "0002_audit_immutability",
    up: `
      -- The audit log and the payment ledger are append-only. These triggers make
      -- that a database guarantee rather than a convention, so no service (and no
      -- admin tool) can quietly rewrite financial history.
      CREATE TRIGGER audit_log_no_update
      BEFORE UPDATE ON audit_log
      BEGIN
        SELECT RAISE(ABORT, 'audit_log is append-only');
      END;

      CREATE TRIGGER audit_log_no_delete
      BEFORE DELETE ON audit_log
      BEGIN
        SELECT RAISE(ABORT, 'audit_log is append-only');
      END;

      CREATE TRIGGER payments_no_delete
      BEFORE DELETE ON payments
      BEGIN
        SELECT RAISE(ABORT, 'payments are immutable once recorded');
      END;

      -- A confirmed payment may never change amount, recipient, or transaction hash.
      CREATE TRIGGER payments_confirmed_immutable
      BEFORE UPDATE ON payments
      WHEN OLD.status = 'confirmed'
        AND (NEW.amount <> OLD.amount
          OR NEW.recipient_address <> OLD.recipient_address
          OR IFNULL(NEW.tx_hash, '') <> IFNULL(OLD.tx_hash, ''))
      BEGIN
        SELECT RAISE(ABORT, 'confirmed payments cannot be altered');
      END;

      CREATE TRIGGER activity_no_update
      BEFORE UPDATE ON activity_events
      BEGIN
        SELECT RAISE(ABORT, 'activity events are append-only');
      END;
    `,
  },
  {
    name: "0003_search_index",
    up: `
      -- Lightweight search surface. A denormalized table keeps global search on one
      -- index instead of fanning out across six tables on every keystroke.
      CREATE TABLE search_index (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        owner_ids TEXT NOT NULL DEFAULT '[]',
        title TEXT NOT NULL,
        subtitle TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        href TEXT NOT NULL,
        is_public INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        UNIQUE (entity_type, entity_id)
      );
      CREATE INDEX idx_search_title ON search_index(title);
      CREATE INDEX idx_search_type ON search_index(entity_type);
    `,
  },
];
