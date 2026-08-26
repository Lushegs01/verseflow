/**
 * Activity, notifications, audit, and analytics recording.
 *
 * Every meaningful state change writes an activity event. Together they form the
 * agreement's audit trail -- the thing a user reads to answer "what happened?"
 * without needing to trust anyone's summary.
 */

import type { DatabaseSync } from "node:sqlite";
import {
  activityRepo,
  auditRepo,
  notificationsRepo,
  analyticsRepo,
  searchRepo,
} from "@/lib/db/repositories";
import type {
  ActivityType,
  AnalyticsEventName,
  NotificationKind,
  Agreement,
  Milestone,
} from "@/lib/domain/types";
import { newId, nowIso } from "@/lib/domain/ids";
import { formatMoney } from "@/lib/domain/money";

export function recordActivity(params: {
  agreementId: string | null;
  milestoneId?: string | null;
  actorId: string | null;
  actorLabel: string;
  type: ActivityType;
  summary: string;
  metadata?: Record<string, unknown>;
  txHash?: string | null;
  db?: DatabaseSync;
}) {
  return activityRepo.insert(
    {
      id: newId("act"),
      agreementId: params.agreementId,
      milestoneId: params.milestoneId ?? null,
      actorId: params.actorId,
      actorLabel: params.actorLabel,
      type: params.type,
      summary: params.summary,
      metadata: params.metadata ?? {},
      txHash: params.txHash ?? null,
      createdAt: nowIso(),
    },
    params.db,
  );
}

export function notify(params: {
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href?: string | null;
  agreementId?: string | null;
  db?: DatabaseSync;
}) {
  // Respect the recipient's preferences. An unset preference defaults to on --
  // people should not miss a payment notification because of a missing row.
  const prefs = notificationsRepo.preferences(params.userId, params.db);
  if (prefs.channels && prefs.channels[params.kind] === false) return null;

  return notificationsRepo.insert(
    {
      id: newId("ntf"),
      userId: params.userId,
      kind: params.kind,
      title: params.title,
      body: params.body,
      href: params.href ?? null,
      agreementId: params.agreementId ?? null,
      readAt: null,
      createdAt: nowIso(),
    },
    params.db,
  );
}

export function audit(params: {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  db?: DatabaseSync;
}) {
  return auditRepo.insert(
    {
      id: newId("aud"),
      actorId: params.actorId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      before: params.before ?? null,
      after: params.after ?? null,
      ip: params.ip ?? null,
      createdAt: nowIso(),
    },
    params.db,
  );
}

/**
 * Record a product analytics event and forward it to Verse App Analytics.
 *
 * Forwarding is fire-and-forget: analytics must never be able to fail a payment.
 */
export function track(params: {
  name: AnalyticsEventName;
  userId: string | null;
  anonymousId?: string;
  agreementId?: string | null;
  properties?: Record<string, unknown>;
  db?: DatabaseSync;
}) {
  const event = analyticsRepo.insert(
    {
      id: newId("anl"),
      name: params.name,
      userId: params.userId,
      anonymousId: params.anonymousId ?? params.userId ?? "anonymous",
      agreementId: params.agreementId ?? null,
      properties: params.properties ?? {},
      forwarded: false,
      createdAt: nowIso(),
    },
    params.db,
  );

  void forwardToVerseAnalytics(event.name, {
    ...event.properties,
    agreementId: event.agreementId,
    distinctId: event.userId ?? event.anonymousId,
  });

  return event;
}

/**
 * Verse App Analytics forwarder.
 *
 * The endpoint and key come from the environment. With neither set, events are
 * still recorded locally and drive the internal analytics console -- the product
 * measures itself either way.
 */
async function forwardToVerseAnalytics(
  name: string,
  properties: Record<string, unknown>,
): Promise<void> {
  const endpoint = process.env.VERSE_ANALYTICS_ENDPOINT;
  const appId = process.env.VERSE_ANALYTICS_APP_ID;
  const apiKey = process.env.VERSE_ANALYTICS_API_KEY;
  if (!endpoint || !appId) return;

  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 4000);
    await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        appId,
        event: name,
        timestamp: new Date().toISOString(),
        properties,
      }),
      signal: controller.signal,
    });
  } catch {
    // Deliberately silent. A dropped analytics event is not worth surfacing to a
    // user in the middle of funding an agreement.
  }
}

// ---------------------------------------------------------------------------
// Search indexing
// ---------------------------------------------------------------------------

export function indexAgreement(agreement: Agreement, milestones: Milestone[], db?: DatabaseSync) {
  const owners = [agreement.clientId, agreement.providerId].filter((v): v is string => Boolean(v));

  searchRepo.upsert(
    {
      entityType: "agreement",
      entityId: agreement.id,
      ownerIds: owners,
      title: agreement.title,
      subtitle: `${agreement.reference} · ${formatMoney(agreement.totalAmount, agreement.asset)}`,
      body: [
        agreement.reference,
        agreement.description,
        agreement.agreementHash ?? "",
        agreement.fundingTxHash ?? "",
        ...milestones.map((m) => m.title),
      ].join(" "),
      href: `/app/agreements/${agreement.id}`,
      isPublic: false,
    },
    db,
  );

  for (const milestone of milestones) {
    searchRepo.upsert(
      {
        entityType: "milestone",
        entityId: milestone.id,
        ownerIds: owners,
        title: milestone.title,
        subtitle: `${agreement.title} · ${formatMoney(milestone.amount, agreement.asset)}`,
        body: [milestone.description, ...milestone.deliverables].join(" "),
        href: `/app/agreements/${agreement.id}?milestone=${milestone.id}`,
        isPublic: false,
      },
      db,
    );
  }
}

export function indexPayment(
  payment: { id: string; txHash: string | null; amount: number; asset: string; agreementId: string },
  ownerIds: string[],
  agreementTitle: string,
  db?: DatabaseSync,
) {
  searchRepo.upsert(
    {
      entityType: "payment",
      entityId: payment.id,
      ownerIds,
      title: `${formatMoney(payment.amount, payment.asset)} payment`,
      subtitle: agreementTitle,
      body: [payment.id, payment.txHash ?? ""].join(" "),
      href: `/app/agreements/${payment.agreementId}?payment=${payment.id}`,
      isPublic: false,
    },
    db,
  );
}

export function indexPublicProfile(
  user: { id: string; handle: string; displayName: string; headline: string },
  db?: DatabaseSync,
) {
  searchRepo.upsert(
    {
      entityType: "user",
      entityId: user.id,
      ownerIds: [user.id],
      title: user.displayName,
      subtitle: user.headline,
      body: user.handle,
      href: `/p/${user.handle}`,
      isPublic: true,
    },
    db,
  );
}
