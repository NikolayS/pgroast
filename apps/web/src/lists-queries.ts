import type { WebDatabase } from "./db.ts";

export async function getMailingListsOverview(db: WebDatabase) {
  const now = Date.now();
  const cut24h = new Date(now - 86_400_000).toISOString();
  const cut7d = new Date(now - 7 * 86_400_000).toISOString();
  const cut30d = new Date(now - 30 * 86_400_000).toISOString();

  const [listsRows, totalsRows, dailyRows, perListDailyRows, perListLinkedRows, hotThreadsRows, topPostersRows] = await Promise.all([
    db.sql.unsafe(
      `SELECT name, category, message_count, first_sent_at, last_sent_at, last_synced_at, status
       FROM ${db.t("mailing_lists")}
       ORDER BY message_count DESC, name ASC`,
    ) as Promise<Array<{ name: string; category: string; message_count: number; first_sent_at: string; last_sent_at: string; last_synced_at: string; status: string }>>,
    db.sql.unsafe(
      `SELECT
         COUNT(*)::int AS total_messages,
         COUNT(DISTINCT thread_key)::int AS total_threads,
         COUNT(*) FILTER (WHERE sent_at >= $1)::int AS last_24h,
         COUNT(*) FILTER (WHERE sent_at >= $2)::int AS last_7d,
         COUNT(*) FILTER (WHERE sent_at >= $3)::int AS last_30d,
         COUNT(*) FILTER (WHERE has_attachment)::int AS with_attachments,
         COUNT(*) FILTER (WHERE person_id IS NOT NULL)::int AS linked_messages,
         COUNT(DISTINCT person_id) FILTER (WHERE person_id IS NOT NULL)::int AS unique_hackers
       FROM ${db.t("mailing_list_messages")}`,
      [cut24h, cut7d, cut30d],
    ) as Promise<Array<Record<string, number>>>,
    db.sql.unsafe(
      `SELECT
         SUBSTRING(sent_at, 1, 10) AS day,
         COUNT(*)::int AS count,
         COUNT(*) FILTER (WHERE person_id IS NOT NULL)::int AS linked
       FROM ${db.t("mailing_list_messages")}
       WHERE sent_at >= $1
       GROUP BY 1
       ORDER BY 1 ASC`,
      [cut30d],
    ) as Promise<Array<{ day: string; count: number; linked: number }>>,
    db.sql.unsafe(
      `SELECT list_name, SUBSTRING(sent_at, 1, 10) AS day, COUNT(*)::int AS count
       FROM ${db.t("mailing_list_messages")}
       WHERE sent_at >= $1
       GROUP BY 1, 2
       ORDER BY 1, 2`,
      [cut30d],
    ) as Promise<Array<{ list_name: string; day: string; count: number }>>,
    db.sql.unsafe(
      `SELECT list_name, COUNT(*) FILTER (WHERE person_id IS NOT NULL)::int AS linked
       FROM ${db.t("mailing_list_messages")}
       GROUP BY 1`,
    ) as Promise<Array<{ list_name: string; linked: number }>>,
    db.sql.unsafe(
      `SELECT
         list_name,
         thread_key,
         MIN(subject) AS subject,
         COUNT(*)::int AS messages,
         COUNT(DISTINCT sender_name)::int AS participants,
         BOOL_OR(has_attachment) AS has_attachment,
         MAX(sent_at) AS last_sent_at,
         (ARRAY_AGG(message_id ORDER BY sent_at ASC))[1] AS first_message_id
       FROM ${db.t("mailing_list_messages")}
       WHERE sent_at >= $1 AND thread_key != ''
       GROUP BY list_name, thread_key
       ORDER BY messages DESC, last_sent_at DESC
       LIMIT 15`,
      [cut30d],
    ) as Promise<Array<{ list_name: string; thread_key: string; subject: string; messages: number; participants: number; has_attachment: boolean; last_sent_at: string; first_message_id: string }>>,
    db.sql.unsafe(
      `SELECT
         COALESCE(p.slug, '') AS slug,
         COALESCE(p.canonical_name, m.sender_name) AS name,
         COALESCE(p.pg_role, 'Contributor') AS role,
         COUNT(*)::int AS count,
         COUNT(DISTINCT m.list_name)::int AS lists_count
       FROM ${db.t("mailing_list_messages")} m
       LEFT JOIN ${db.t("people")} p ON p.id = m.person_id
       WHERE m.sent_at >= $1 AND m.sender_name != ''
       GROUP BY 1, 2, 3
       ORDER BY count DESC
       LIMIT 15`,
      [cut30d],
    ) as Promise<Array<{ slug: string; name: string; role: string; count: number; lists_count: number }>>,
  ]);

  const t = totalsRows[0] ?? {};
  const lastSyncedAt = listsRows.reduce((acc, r) => (r.last_synced_at > acc ? r.last_synced_at : acc), "");
  const linkedByList = new Map(perListLinkedRows.map((r) => [r.list_name, Number(r.linked || 0)]));
  const allDays = dailyRows.map((d) => d.day);
  const perListDayMap = new Map<string, Map<string, number>>();
  for (const r of perListDailyRows) {
    if (!perListDayMap.has(r.list_name)) perListDayMap.set(r.list_name, new Map());
    perListDayMap.get(r.list_name)!.set(r.day, Number(r.count || 0));
  }

  return {
    catalogCount: listsRows.length,
    syncedListsCount: listsRows.filter((r) => r.status === "synced").length,
    lastSyncedAt,
    totals: {
      totalMessages: Number(t.total_messages || 0),
      totalThreads: Number(t.total_threads || 0),
      last24h: Number(t.last_24h || 0),
      last7d: Number(t.last_7d || 0),
      last30d: Number(t.last_30d || 0),
      withAttachments: Number(t.with_attachments || 0),
      linkedMessages: Number(t.linked_messages || 0),
      uniqueHackers: Number(t.unique_hackers || 0),
    },
    lists: listsRows.map((r) => {
      const cnt = Number(r.message_count || 0);
      const lnk = linkedByList.get(r.name) ?? 0;
      const dmap = perListDayMap.get(r.name);
      const sparkline = allDays.slice(-14).map((d) => dmap?.get(d) ?? 0);
      return {
        name: r.name,
        category: r.category,
        messageCount: cnt,
        linkedPct: cnt > 0 ? Math.round((lnk / cnt) * 100) : 0,
        sparkline,
        firstSentAt: r.first_sent_at || "",
        lastSentAt: r.last_sent_at || "",
        lastSyncedAt: r.last_synced_at || "",
        status: r.status,
      };
    }),
    daily: dailyRows.map((r) => ({ day: r.day, count: Number(r.count), linked: Number(r.linked || 0) })),
    hotThreads: hotThreadsRows.map((r) => ({
      listName: r.list_name,
      subject: r.subject,
      messages: Number(r.messages),
      participants: Number(r.participants),
      hasAttachment: Boolean(r.has_attachment),
      lastSentAt: r.last_sent_at,
      messageId: r.first_message_id,
    })),
    topPosters: topPostersRows.map((r) => ({
      slug: r.slug || "",
      name: r.name,
      role: r.role,
      count: Number(r.count),
      listsCount: Number(r.lists_count),
    })),
  };
}

export async function searchMailingListMessages(
  db: WebDatabase,
  opts: {
    list?: string;
    search?: string;
    hasAttachment?: boolean;
    personSlug?: string;
    limit?: number;
  },
) {
  const conds: string[] = [];
  const params: unknown[] = [];

  if (opts.list && opts.list !== "all") {
    params.push(opts.list.toLowerCase());
    conds.push(`m.list_name = $${params.length}`);
  }
  if (opts.hasAttachment) {
    conds.push(`m.has_attachment = TRUE`);
  }
  if (opts.personSlug) {
    params.push(opts.personSlug.toLowerCase());
    conds.push(`p.slug = $${params.length}`);
  }
  if (opts.search?.trim()) {
    params.push(`%${opts.search.trim().toLowerCase()}%`);
    const idx = params.length;
    conds.push(`(LOWER(m.subject) LIKE $${idx} OR LOWER(m.sender_name) LIKE $${idx} OR LOWER(m.body_excerpt) LIKE $${idx})`);
  }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(200, opts.limit ?? 60));
  params.push(limit);

  const rows = (await db.sql.unsafe(
    `SELECT
       m.list_name, m.message_id, m.subject, m.sender_name, m.sent_at,
       m.has_attachment, m.body_excerpt, COALESCE(p.slug, '') AS person_slug
     FROM ${db.t("mailing_list_messages")} m
     LEFT JOIN ${db.t("people")} p ON p.id = m.person_id
     ${where}
     ORDER BY m.sent_at DESC
     LIMIT $${params.length}`,
    params,
  )) as Array<{
    list_name: string;
    message_id: string;
    subject: string;
    sender_name: string;
    sent_at: string;
    has_attachment: boolean;
    body_excerpt: string;
    person_slug: string;
  }>;

  return rows.map((r) => ({
    listName: r.list_name,
    messageId: r.message_id,
    subject: r.subject,
    senderName: r.sender_name,
    sentAt: r.sent_at,
    hasAttachment: Boolean(r.has_attachment),
    bodyExcerpt: r.body_excerpt || "",
    personSlug: r.person_slug || "",
    archiveUrl: `https://www.postgresql.org/message-id/${encodeURIComponent(r.message_id)}`,
  }));
}

export async function getHackerMailingListStats(db: WebDatabase, personId: number) {
  const [byListRows, recentRows] = await Promise.all([
    db.sql.unsafe(
      `SELECT list_name, COUNT(*)::int AS count
       FROM ${db.t("mailing_list_messages")}
       WHERE person_id = $1
       GROUP BY list_name
       ORDER BY count DESC
       LIMIT 10`,
      [personId],
    ) as Promise<Array<{ list_name: string; count: number }>>,
    db.sql.unsafe(
      `SELECT list_name, message_id, subject, sent_at, has_attachment
       FROM ${db.t("mailing_list_messages")}
       WHERE person_id = $1
       ORDER BY sent_at DESC
       LIMIT 30`,
      [personId],
    ) as Promise<Array<{ list_name: string; message_id: string; subject: string; sent_at: string; has_attachment: boolean }>>,
  ]);

  const totalMessages = byListRows.reduce((acc, r) => acc + Number(r.count || 0), 0);
  return {
    totalMessages,
    byList: byListRows.map((r) => ({ list: r.list_name, count: Number(r.count) })),
    recentMessages: recentRows.map((r) => ({
      listName: r.list_name,
      messageId: r.message_id,
      subject: r.subject,
      sentAt: r.sent_at,
      hasAttachment: Boolean(r.has_attachment),
      archiveUrl: `https://www.postgresql.org/message-id/${encodeURIComponent(r.message_id)}`,
    })),
  };
}
