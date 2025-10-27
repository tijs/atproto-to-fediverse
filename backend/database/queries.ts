import { sqlite } from "https://esm.town/v/stevekrouse/sqlite";
import { TABLES } from "./migrations.ts";

export interface UserAccount {
  id: number;
  atproto_did?: string;
  atproto_handle?: string;
  atproto_access_token?: string;
  atproto_refresh_token?: string;
  atproto_token_expires_at?: number;
  atproto_dpop_private_key?: string;
  atproto_dpop_public_jwk?: string;
  atproto_app_password?: string;
  mastodon_instance_url?: string;
  mastodon_username?: string;
  mastodon_access_token?: string;
  mastodon_client_id?: string;
  mastodon_client_secret?: string;
  setup_completed: boolean;
  last_sync_at?: number;
  last_sync_cursor?: string;
  created_at: number;
  updated_at: number;
}

export interface PostTracking {
  id: number;
  atproto_uri: string;
  atproto_cid: string;
  atproto_rkey: string;
  mastodon_id?: string;
  mastodon_url?: string;
  content_hash: string;
  sync_status: "pending" | "success" | "failed" | "skipped";
  error_message?: string;
  retry_count: number;
  max_retries: number;
  atproto_created_at: number;
  synced_at?: number;
  created_at: number;
  updated_at: number;
}

export interface SyncLog {
  id: number;
  sync_type: "manual" | "cron" | "webhook";
  posts_fetched: number;
  posts_synced: number;
  posts_failed: number;
  posts_skipped: number;
  error_message?: string;
  stack_trace?: string;
  duration_ms?: number;
  cursor_start?: string;
  cursor_end?: string;
  created_at: number;
}

export interface Settings {
  id: number;
  sync_enabled: boolean;
  sync_interval_minutes: number;
  skip_replies: boolean;
  skip_mentions: boolean;
  skip_reposts: boolean;
  include_media: boolean;
  compress_images: boolean;
  created_at: number;
  updated_at: number;
}

// Single User Account queries
export async function createUserAccount(): Promise<UserAccount> {
  const result = await sqlite.execute(
    `INSERT INTO ${TABLES.USER_ACCOUNTS} (id) VALUES (1) RETURNING *`,
  );
  return result.rows[0] as unknown as UserAccount;
}

export async function getUserAccount(): Promise<UserAccount | null> {
  const result = await sqlite.execute(
    `SELECT * FROM ${TABLES.USER_ACCOUNTS} WHERE id = 1`,
  );
  return (result.rows[0] as unknown as UserAccount) || null;
}

// Lookup user account by ATProto handle
export async function getUserAccountByHandle(
  handle: string,
): Promise<UserAccount | null> {
  const normalized = handle.toLowerCase().replace(/^@/, "");
  const result = await sqlite.execute(
    `SELECT * FROM ${TABLES.USER_ACCOUNTS} WHERE lower(atproto_handle) = ? LIMIT 1`,
    [normalized],
  );
  return (result.rows[0] as unknown as UserAccount) || null;
}

// Get the single user account (for single-user service)
export async function getSingleUserAccount(): Promise<UserAccount | null> {
  return await getUserAccount();
}

export async function updateUserAccount(
  updates: Partial<UserAccount>,
): Promise<void> {
  const keys = Object.keys(updates);
  const values = Object.values(updates);
  const setClause = keys.map((key) => `${key} = ?`).join(", ");

  await sqlite.execute(
    `UPDATE ${TABLES.USER_ACCOUNTS} SET ${setClause}, updated_at = unixepoch() WHERE id = 1`,
    values,
  );
}

// Settings queries
export async function createDefaultSettings(): Promise<Settings> {
  const result = await sqlite.execute(
    `INSERT INTO ${TABLES.SETTINGS} (id) VALUES (1) RETURNING *`,
  );
  return result.rows[0] as unknown as Settings;
}

export async function getSettings(): Promise<Settings | null> {
  const result = await sqlite.execute(
    `SELECT * FROM ${TABLES.SETTINGS} WHERE id = 1`,
  );
  return (result.rows[0] as unknown as Settings) || null;
}

export async function updateSettings(
  updates: Partial<Settings>,
): Promise<void> {
  const keys = Object.keys(updates);
  const values = Object.values(updates);
  const setClause = keys.map((key) => `${key} = ?`).join(", ");

  await sqlite.execute(
    `UPDATE ${TABLES.SETTINGS} SET ${setClause}, updated_at = unixepoch() WHERE id = 1`,
    values,
  );
}

// Post tracking queries
export async function getRecentPosts(
  limit: number = 10,
): Promise<PostTracking[]> {
  const result = await sqlite.execute(
    `SELECT * FROM ${TABLES.POST_TRACKING} 
     WHERE sync_status = 'success' 
     ORDER BY synced_at DESC 
     LIMIT ?`,
    [limit],
  );
  return result.rows as unknown as PostTracking[];
}

export async function cullOldPostLogs(keepCount: number = 100): Promise<void> {
  // Delete old post tracking records, keeping only the most recent ones
  await sqlite.execute(
    `
    DELETE FROM ${TABLES.POST_TRACKING}
    WHERE id NOT IN (
      SELECT id FROM ${TABLES.POST_TRACKING}
      ORDER BY created_at DESC
      LIMIT ?
    )
  `,
    [keepCount],
  );
}

export async function getPostStats(): Promise<{
  posts_synced: number;
  posts_failed: number;
  posts_pending: number;
}> {
  const result = await sqlite.execute(`
    SELECT 
      COUNT(CASE WHEN sync_status = 'success' THEN 1 END) as posts_synced,
      COUNT(CASE WHEN sync_status = 'failed' THEN 1 END) as posts_failed,
      COUNT(CASE WHEN sync_status = 'pending' THEN 1 END) as posts_pending
    FROM ${TABLES.POST_TRACKING}
  `);

  const row = result.rows[0] as any;
  return {
    posts_synced: row.posts_synced || 0,
    posts_failed: row.posts_failed || 0,
    posts_pending: row.posts_pending || 0,
  };
}

// Sync log queries
export async function getRecentSyncLogs(limit: number = 5): Promise<SyncLog[]> {
  const result = await sqlite.execute(
    `SELECT * FROM ${TABLES.SYNC_LOGS} ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
  return result.rows as unknown as SyncLog[];
}

export async function getLastSyncLog(): Promise<SyncLog | null> {
  const result = await sqlite.execute(
    `SELECT * FROM ${TABLES.SYNC_LOGS} ORDER BY created_at DESC LIMIT 1`,
  );
  return (result.rows[0] as unknown as SyncLog) || null;
}
