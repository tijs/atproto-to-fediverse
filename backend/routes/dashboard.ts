import { Hono } from "https://esm.sh/hono@3.11.7";
import {
  getLastSyncLog,
  getPostStats,
  getRecentPosts,
  getSettings,
  getUserAccount,
} from "../database/queries.ts";
import { requireAuth } from "./auth.ts";
import { SyncService } from "../services/sync-service.ts";
import { SQLiteStorageProvider } from "../storage/sqlite-storage.ts";
import { ATProtoClientAdapter } from "../services/atproto-client-adapter.ts";
import { MastodonClientMasto } from "../services/mastodon-client-masto.ts";

const dashboard = new Hono();

// Test endpoint to check if dashboard route is registered
dashboard.get("/test", (c) => {
  console.log("Dashboard test endpoint hit");
  return c.json({ message: "Dashboard route is working" });
});

// Get dashboard data for authenticated user - handle both / and empty path
dashboard.get("/", requireAuth(), async (c) => {
  console.log("Dashboard route hit, user ID:", c.get("userId"));
  const userId = c.get("userId") as string;

  try {
    const user = await getUserAccount();
    console.log("User lookup result:", { userId, userFound: !!user, user });

    if (!user) {
      console.log("User not found in database for ID:", userId);
      return c.json({ error: "User not found" }, 404);
    }

    // Get user settings
    const settings = await getSettings();

    // Get dashboard data from database
    const [postStats, recentPosts, lastSyncLog] = await Promise.all([
      getPostStats(),
      getRecentPosts(25), // Show last 25 posts
      getLastSyncLog(),
    ]);

    const dashboardData = {
      user: {
        id: user.id,
        atproto_handle: user.atproto_handle,
        mastodon_username: user.mastodon_username,
        setup_completed: user.setup_completed,
      },
      settings: {
        sync_enabled: settings?.sync_enabled ?? true,
        sync_interval_minutes: settings?.sync_interval_minutes ?? 15,
      },
      stats: {
        posts_synced: postStats.posts_synced,
        posts_failed: postStats.posts_failed,
        posts_pending: postStats.posts_pending,
        last_sync: lastSyncLog
          ? (() => {
            // Smart detection: if timestamp is > 1e10, it's likely milliseconds
            const timestamp = lastSyncLog.created_at > 1e10
              ? lastSyncLog.created_at
              : lastSyncLog.created_at * 1000;
            return new Date(timestamp).toISOString();
          })()
          : null,
        last_sync_duration_ms: lastSyncLog?.duration_ms || null,
        last_sync_posts_fetched: lastSyncLog?.posts_fetched || 0,
        last_sync_posts_synced: lastSyncLog?.posts_synced || 0,
        last_sync_posts_failed: lastSyncLog?.posts_failed || 0,
      },
      recent_posts: recentPosts.map((post) => ({
        id: post.id,
        atproto_uri: post.atproto_uri,
        atproto_rkey: post.atproto_rkey,
        mastodon_url: post.mastodon_url,
        sync_status: post.sync_status,
        error_message: post.error_message,
        atproto_created_at: (() => {
          if (!post.atproto_created_at) {
            return null;
          }
          // Smart detection: if timestamp is > 1e10, it's likely milliseconds
          const timestamp = post.atproto_created_at > 1e10
            ? post.atproto_created_at
            : post.atproto_created_at * 1000;
          const result = new Date(timestamp).toISOString();
          if (result === "Invalid Date") {
            return null;
          }
          return result;
        })(),
        synced_at: post.synced_at
          ? (() => {
            // Smart detection: if timestamp is > 1e10, it's likely milliseconds
            const timestamp = post.synced_at > 1e10
              ? post.synced_at
              : post.synced_at * 1000;
            return new Date(timestamp).toISOString();
          })()
          : null,
        retry_count: post.retry_count,
      })),
    };

    return c.json(dashboardData);
  } catch (error) {
    console.error("Dashboard data fetch error:", error);
    return c.json({ error: "Failed to fetch dashboard data" }, 500);
  }
});

// Update user settings
dashboard.put("/settings", requireAuth(), async (c) => {
  const userId = c.get("userId") as string;

  try {
    const body = await c.req.json();

    // For now, just return success - in a real implementation,
    // you'd update the user settings in the database
    console.log("Settings update for user:", userId, body);

    return c.json({ success: true });
  } catch (error) {
    console.error("Settings update error:", error);
    return c.json({ error: "Failed to update settings" }, 500);
  }
});

// Reset user auth (clear tokens to force re-authentication)
dashboard.post("/reset-auth", requireAuth(), async (c) => {
  try {
    console.log("Resetting user authentication...");

    const storage = new SQLiteStorageProvider();
    await storage.userAccounts.updateSingle({
      atproto_access_token: null,
      atproto_refresh_token: null,
      atproto_token_expires_at: null,
      setup_completed: false,
    });

    return c.json({
      success: true,
      message: "Authentication reset. Please go through setup again.",
    });
  } catch (error) {
    console.error("Reset auth error:", error);
    return c.json({ error: "Failed to reset authentication" }, 500);
  }
});

// Trigger manual sync
dashboard.post("/sync", requireAuth(), async (c) => {
  const userId = c.get("userId") as string;

  try {
    console.log("Manual sync triggered for user:", userId);

    // Set up dependencies for the sync service
    const storage = new SQLiteStorageProvider();
    const syncService = new SyncService({
      storage,
      createATProtoClient: (
        pdsUrl,
        accessToken,
        refreshToken,
        did,
        onTokenRefresh,
        appPassword,
      ) =>
        new ATProtoClientAdapter(
          pdsUrl,
          accessToken,
          refreshToken,
          did,
          onTokenRefresh,
          appPassword,
        ),
      createMastodonClient: (instanceUrl, accessToken) =>
        new MastodonClientMasto(instanceUrl, accessToken),
    });

    // Run sync for the single user
    const result = await syncService.syncUser();

    console.log("Manual sync completed:", result);

    return c.json({
      success: true,
      message: "Sync completed",
      result: {
        postsProcessed: result.postsProcessed,
        postsSuccessful: result.postsSuccessful,
        postsFailed: result.postsFailed,
        errors: result.errors,
      },
    });
  } catch (error) {
    console.error("Manual sync error:", error);

    // Check for authentication errors that require re-auth
    if (
      error instanceof Error && (
        error.message.includes("Bad token scope") ||
        error.message.includes("InvalidToken") ||
        error.message.includes("ATProto tokens are invalid")
      )
    ) {
      return c.json({
        error:
          "Authentication error: Your Bluesky tokens have expired or are invalid. Please reconnect your account.",
        needsReauth: true,
      }, 401);
    }

    return c.json({
      error: error instanceof Error ? error.message : "Failed to trigger sync",
    }, 500);
  }
});

export default dashboard;
