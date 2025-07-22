import { sqlite } from "https://esm.town/v/stevekrouse/sqlite";

// Database schema for ATProto-to-Fediverse bridge
export const TABLES = {
  USER_ACCOUNTS: "bridge_user_accounts_v1",
  SYNC_LOGS: "bridge_sync_logs_v1",
  POST_TRACKING: "bridge_post_tracking_v1",
  SETTINGS: "bridge_settings_v1",
};

export async function runMigrations() {
  // Drop old tables that might have incompatible schemas
  try {
    await sqlite.execute("DROP TABLE IF EXISTS bridge_sync_logs_v1_old");
    await sqlite.execute("DROP TABLE IF EXISTS bridge_post_tracking_v1_old");

    // Check if current sync logs table has user_id column (old schema)
    const syncLogsTableInfo = await sqlite.execute(
      "PRAGMA table_info(bridge_sync_logs_v1)",
    );
    const syncLogsHasUserId = syncLogsTableInfo.rows.some((row: any) =>
      row.name === "user_id"
    );

    if (syncLogsHasUserId) {
      console.log(
        "Found old sync logs table with user_id column, recreating...",
      );
      await sqlite.execute(
        "ALTER TABLE bridge_sync_logs_v1 RENAME TO bridge_sync_logs_v1_old",
      );
    }

    // Check if current post tracking table has user_id column (old schema)
    const postTrackingTableInfo = await sqlite.execute(
      "PRAGMA table_info(bridge_post_tracking_v1)",
    );
    const postTrackingHasUserId = postTrackingTableInfo.rows.some((row: any) =>
      row.name === "user_id"
    );

    if (postTrackingHasUserId) {
      console.log(
        "Found old post tracking table with user_id column, recreating...",
      );
      await sqlite.execute(
        "ALTER TABLE bridge_post_tracking_v1 RENAME TO bridge_post_tracking_v1_old",
      );
    }
  } catch (_error) {
    // Table might not exist yet, that's fine
    console.log("Migration check completed");
  }

  // Add missing DPoP columns if they don't exist
  try {
    const userTableInfo = await sqlite.execute(
      "PRAGMA table_info(bridge_user_accounts_v1)",
    );
    const hasPrivateKey = userTableInfo.rows.some((row: any) =>
      row.name === "atproto_dpop_private_key"
    );
    const hasPublicJwk = userTableInfo.rows.some((row: any) =>
      row.name === "atproto_dpop_public_jwk"
    );

    if (!hasPrivateKey) {
      console.log("Adding atproto_dpop_private_key column...");
      await sqlite.execute(
        "ALTER TABLE bridge_user_accounts_v1 ADD COLUMN atproto_dpop_private_key TEXT",
      );
    }

    if (!hasPublicJwk) {
      console.log("Adding atproto_dpop_public_jwk column...");
      await sqlite.execute(
        "ALTER TABLE bridge_user_accounts_v1 ADD COLUMN atproto_dpop_public_jwk TEXT",
      );
    }

    const hasAppPassword = userTableInfo.rows.some((row: any) =>
      row.name === "atproto_app_password"
    );
    if (!hasAppPassword) {
      console.log("Adding atproto_app_password column...");
      await sqlite.execute(
        "ALTER TABLE bridge_user_accounts_v1 ADD COLUMN atproto_app_password TEXT",
      );
    }
  } catch (_error) {
    console.log("DPoP column migration check completed");
  }

  // Single user configuration - stores OAuth tokens and account info
  await sqlite.execute(`
    CREATE TABLE IF NOT EXISTS ${TABLES.USER_ACCOUNTS} (
      id INTEGER PRIMARY KEY CHECK (id = 1), -- Enforce single row
      
      -- Bluesky/ATProto account
      atproto_did TEXT,
      atproto_pds_url TEXT,
      atproto_handle TEXT,
      atproto_access_token TEXT,
      atproto_refresh_token TEXT,
      atproto_token_expires_at INTEGER,
      atproto_dpop_private_key TEXT, -- DPoP private key JWK for token binding
      atproto_dpop_public_jwk TEXT,  -- DPoP public key JWK
      atproto_app_password TEXT,     -- App Password for sync service
      
      -- Mastodon account
      mastodon_instance_url TEXT,
      mastodon_username TEXT,
      mastodon_access_token TEXT,
      mastodon_client_id TEXT,
      mastodon_client_secret TEXT,
      
      -- Status tracking
      setup_completed BOOLEAN DEFAULT FALSE,
      last_sync_at INTEGER,
      last_sync_cursor TEXT, -- ATProto cursor for pagination
      
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )
  `);

  // Settings table - user preferences and configuration
  await sqlite.execute(`
    CREATE TABLE IF NOT EXISTS ${TABLES.SETTINGS} (
      id INTEGER PRIMARY KEY CHECK (id = 1), -- Enforce single row
      
      -- Sync settings
      sync_enabled BOOLEAN DEFAULT TRUE,
      sync_interval_minutes INTEGER DEFAULT 15, -- 15 min for free tier
      
      -- Post filtering (for future versions)
      skip_replies BOOLEAN DEFAULT TRUE,
      skip_mentions BOOLEAN DEFAULT TRUE,
      skip_reposts BOOLEAN DEFAULT FALSE,
      
      -- Media handling
      include_media BOOLEAN DEFAULT TRUE,
      compress_images BOOLEAN DEFAULT FALSE,
      
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )
  `);

  // Post tracking table - prevent duplicate posts and track sync status
  await sqlite.execute(`
    CREATE TABLE IF NOT EXISTS ${TABLES.POST_TRACKING} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      
      -- Bluesky post identifiers
      atproto_uri TEXT NOT NULL, -- at:// URI
      atproto_cid TEXT NOT NULL, -- Content ID
      atproto_rkey TEXT NOT NULL, -- Record key
      
      -- Mastodon post identifiers
      mastodon_id TEXT, -- Mastodon post ID (null if failed)
      mastodon_url TEXT, -- Mastodon post URL
      
      -- Content hash for duplicate detection
      content_hash TEXT NOT NULL,
      
      -- Status tracking
      sync_status TEXT CHECK(sync_status IN ('pending', 'success', 'failed', 'skipped')) DEFAULT 'pending',
      error_message TEXT,
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      
      -- Timestamps
      atproto_created_at INTEGER NOT NULL,
      synced_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      
      UNIQUE(atproto_uri)
    )
  `);

  // Sync logs table - track sync operations and errors
  await sqlite.execute(`
    CREATE TABLE IF NOT EXISTS ${TABLES.SYNC_LOGS} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      
      -- Sync operation details
      sync_type TEXT CHECK(sync_type IN ('manual', 'cron', 'webhook')) DEFAULT 'cron',
      posts_fetched INTEGER DEFAULT 0,
      posts_synced INTEGER DEFAULT 0,
      posts_failed INTEGER DEFAULT 0,
      posts_skipped INTEGER DEFAULT 0,
      
      -- Error tracking
      error_message TEXT,
      stack_trace TEXT,
      
      -- Performance metrics
      duration_ms INTEGER,
      cursor_start TEXT,
      cursor_end TEXT,
      
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);

  // Create indexes for performance
  await sqlite.execute(
    `CREATE INDEX IF NOT EXISTS idx_post_tracking_status ON ${TABLES.POST_TRACKING}(sync_status)`,
  );
  await sqlite.execute(
    `CREATE INDEX IF NOT EXISTS idx_post_tracking_atproto_uri ON ${TABLES.POST_TRACKING}(atproto_uri)`,
  );
  await sqlite.execute(
    `CREATE INDEX IF NOT EXISTS idx_sync_logs_created_at ON ${TABLES.SYNC_LOGS}(created_at)`,
  );
}
