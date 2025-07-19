// Unit tests for storage implementations

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { InMemoryStorageProvider } from "../backend/storage/memory-storage.ts";

Deno.test("InMemoryStorageProvider - user accounts", async () => {
  const storage = new InMemoryStorageProvider();
  await storage.initialize();

  // Test create
  const account = await storage.userAccounts.create();

  assertEquals(account.setup_completed, false);
  assertEquals(typeof account.id, "number");
  assertEquals(typeof account.created_at, "number");
  assertEquals(typeof account.updated_at, "number");

  // Test getSingle
  const retrieved = await storage.userAccounts.getSingle();
  assertEquals(retrieved?.id, account.id);

  // Test updateSingle
  await new Promise((resolve) => setTimeout(resolve, 1)); // Ensure time difference
  await storage.userAccounts.updateSingle({
    setup_completed: true,
    atproto_handle: "test.bsky.social",
  });

  const updated = await storage.userAccounts.getSingle();
  assertEquals(updated?.setup_completed, true);
  assertEquals(updated?.atproto_handle, "test.bsky.social");
  assertEquals(updated?.updated_at >= account.updated_at, true);

  // Test getSingle when no account exists
  storage.userAccounts.clear();
  const nonExistent = await storage.userAccounts.getSingle();
  assertEquals(nonExistent, null);
});

Deno.test("InMemoryStorageProvider - settings", async () => {
  const storage = new InMemoryStorageProvider();
  await storage.initialize();

  // Test create
  const settings = await storage.settings.create();

  assertEquals(settings.sync_enabled, true);
  assertEquals(settings.sync_interval_minutes, 15);
  assertEquals(settings.skip_replies, true);
  assertEquals(settings.include_media, true);

  // Test getSingle
  const retrieved = await storage.settings.getSingle();
  assertEquals(retrieved?.sync_enabled, true);

  // Test updateSingle
  await storage.settings.updateSingle({
    sync_enabled: false,
    sync_interval_minutes: 30,
  });

  const updated = await storage.settings.getSingle();
  assertEquals(updated?.sync_enabled, false);
  assertEquals(updated?.sync_interval_minutes, 30);
  assertEquals(updated?.skip_replies, true); // Should remain unchanged

  // Test getSingle when no settings exist
  storage.settings.clear();
  const nonExistent = await storage.settings.getSingle();
  assertEquals(nonExistent, null);
});

Deno.test("InMemoryStorageProvider - post tracking", async () => {
  const storage = new InMemoryStorageProvider();
  await storage.initialize();

  // Test create
  const postData = {
    atproto_uri: "at://did:plc:test/app.bsky.feed.post/1",
    atproto_cid: "test_cid",
    atproto_rkey: "1",
    content_hash: "hash123",
    atproto_created_at: Math.floor(Date.now() / 1000),
  };

  const post = await storage.postTracking.create(postData);

  assertEquals(post.atproto_uri, postData.atproto_uri);
  assertEquals(post.sync_status, "pending");
  assertEquals(post.retry_count, 0);
  assertEquals(post.max_retries, 3);

  // Test getByUri
  const retrieved = await storage.postTracking.getByUri(postData.atproto_uri);
  assertEquals(retrieved?.id, post.id);
  assertEquals(retrieved?.atproto_uri, postData.atproto_uri);

  // Test updateByUri
  await storage.postTracking.updateByUri(postData.atproto_uri, {
    sync_status: "success",
    mastodon_id: "mastodon_123",
    mastodon_url: "https://mastodon.social/posts/123",
    synced_at: Math.floor(Date.now() / 1000),
  });

  const updated = await storage.postTracking.getByUri(postData.atproto_uri);
  assertEquals(updated?.sync_status, "success");
  assertEquals(updated?.mastodon_id, "mastodon_123");
  assertEquals(updated?.mastodon_url, "https://mastodon.social/posts/123");
  assertEquals(typeof updated?.synced_at, "number");

  // Test getPending
  const pendingPost = await storage.postTracking.create({
    atproto_uri: "at://did:plc:test/app.bsky.feed.post/2",
    atproto_cid: "test_cid_2",
    atproto_rkey: "2",
    content_hash: "hash456",
    atproto_created_at: Math.floor(Date.now() / 1000),
  });

  const pending = await storage.postTracking.getPending();
  assertEquals(pending.length, 1);
  assertEquals(pending[0].id, pendingPost.id);
  assertEquals(pending[0].sync_status, "pending");

  // Test getFailed
  await storage.postTracking.updateByUri(pendingPost.atproto_uri, {
    sync_status: "failed",
    error_message: "Test error",
  });

  const failed = await storage.postTracking.getFailed();
  assertEquals(failed.length, 1);
  assertEquals(failed[0].id, pendingPost.id);
  assertEquals(failed[0].sync_status, "failed");
  assertEquals(failed[0].error_message, "Test error");

  // Test getRecent
  const recent = await storage.postTracking.getRecent();
  assertEquals(recent.length, 2);

  // Test getStats
  const stats = await storage.postTracking.getStats();
  assertEquals(stats.total_posts, 2);
  assertEquals(stats.successful_posts, 1);
  assertEquals(stats.failed_posts, 1);
  assertEquals(stats.pending_posts, 0);
  assertEquals(typeof stats.last_sync, "number");

  // Test getByUri non-existent
  const nonExistent = await storage.postTracking.getByUri("non-existent");
  assertEquals(nonExistent, null);
});

Deno.test("InMemoryStorageProvider - sync logs", async () => {
  const storage = new InMemoryStorageProvider();
  await storage.initialize();

  // Test create
  const logData = {
    sync_type: "cron" as const,
    posts_fetched: 5,
    posts_synced: 3,
    posts_failed: 2,
    posts_skipped: 0,
    duration_ms: 1500,
    cursor_end: "cursor_123",
  };

  const log = await storage.syncLogs.create(logData);

  assertEquals(log.sync_type, "cron");
  assertEquals(log.posts_fetched, 5);
  assertEquals(log.posts_synced, 3);
  assertEquals(log.posts_failed, 2);
  assertEquals(log.duration_ms, 1500);
  assertEquals(log.cursor_end, "cursor_123");
  assertEquals(typeof log.created_at, "number");

  // Test create with error
  await new Promise((resolve) => setTimeout(resolve, 1)); // Ensure time difference
  const errorLogData = {
    sync_type: "manual" as const,
    posts_fetched: 0,
    posts_synced: 0,
    posts_failed: 0,
    posts_skipped: 0,
    error_message: "Test error occurred",
    stack_trace: "Error: Test error\n  at test.ts:123",
  };

  const errorLog = await storage.syncLogs.create(errorLogData);
  assertEquals(errorLog.error_message, "Test error occurred");
  assertEquals(errorLog.stack_trace, "Error: Test error\n  at test.ts:123");

  // Test getRecent
  const recent = await storage.syncLogs.getRecent();
  assertEquals(recent.length, 2);
  assertEquals(recent[0].id, errorLog.id); // Should be more recent
  assertEquals(recent[1].id, log.id);

  // Test getRecent with limit
  const recentLimited = await storage.syncLogs.getRecent(1);
  assertEquals(recentLimited.length, 1);
  assertEquals(recentLimited[0].id, errorLog.id);
});

Deno.test("InMemoryStorageProvider - test helpers", async () => {
  const storage = new InMemoryStorageProvider();
  await storage.initialize();

  // Add some test data
  await storage.userAccounts.create();
  await storage.settings.create();
  await storage.postTracking.create({
    atproto_uri: "at://test/1",
    atproto_cid: "cid1",
    atproto_rkey: "1",
    content_hash: "hash1",
    atproto_created_at: Math.floor(Date.now() / 1000),
  });

  // Test size
  const size = storage.size();
  assertEquals(size.accounts, 1);
  assertEquals(size.settings, 1);
  assertEquals(size.posts, 1);
  assertEquals(size.logs, 0);

  // Test clear
  storage.clear();

  const sizeAfterClear = storage.size();
  assertEquals(sizeAfterClear.accounts, 0);
  assertEquals(sizeAfterClear.settings, 0);
  assertEquals(sizeAfterClear.posts, 0);
  assertEquals(sizeAfterClear.logs, 0);
});

Deno.test("InMemoryStorageProvider - concurrent operations", async () => {
  const storage = new InMemoryStorageProvider();
  await storage.initialize();

  // Test concurrent post tracking operations
  const promises = [];
  for (let i = 0; i < 10; i++) {
    promises.push(storage.postTracking.create({
      atproto_uri: `at://test/${i}`,
      atproto_cid: `cid${i}`,
      atproto_rkey: `${i}`,
      content_hash: `hash${i}`,
      atproto_created_at: Math.floor(Date.now() / 1000),
    }));
  }

  const posts = await Promise.all(promises);
  assertEquals(posts.length, 10);

  // Verify all posts were created with unique IDs
  const ids = posts.map((post) => post.id);
  const uniqueIds = new Set(ids);
  assertEquals(uniqueIds.size, 10);

  // Test concurrent updates
  const updatePromises = [];
  for (let i = 0; i < 10; i++) {
    updatePromises.push(
      storage.postTracking.updateByUri(`at://test/${i}`, {
        sync_status: "success",
        mastodon_id: `mastodon_${i}`,
      }),
    );
  }

  await Promise.all(updatePromises);

  // Verify all updates were applied
  for (let i = 0; i < 10; i++) {
    const post = await storage.postTracking.getByUri(`at://test/${i}`);
    assertEquals(post?.sync_status, "success");
    assertEquals(post?.mastodon_id, `mastodon_${i}`);
  }
});

// Run tests: deno test --allow-read --allow-write tests/storage.test.ts
