// Refactored sync service tests with focused, single-purpose tests

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { InMemoryStorageProvider } from "../backend/storage/memory-storage.ts";
import { SyncService } from "../backend/services/sync-service.ts";
import {
  ATProtoHttpClient,
  MastodonHttpClient,
} from "../backend/interfaces/http-client.ts";
import { ATProtoPost } from "../shared/types.ts";

// Set test environment variables
Deno.env.set("ATPROTO_ALLOWED_HANDLE", "test.bsky.social");

// Minimal mock implementations
class TestATProtoClient implements ATProtoHttpClient {
  constructor(public posts: ATProtoPost[] = []) {}

  fetchPosts(): Promise<any> {
    return Promise.resolve({
      feed: this.posts.map((post) => ({ post })),
      cursor: undefined,
    });
  }

  getPost(uri: string): Promise<any> {
    const post = this.posts.find((p) => p.uri === uri);
    return Promise.resolve(post ? { thread: { post } } : null);
  }

  getProfile(): Promise<any> {
    return Promise.resolve({ did: "did:plc:test", handle: "test.bsky.social" });
  }

  resolveHandle(): Promise<any> {
    return Promise.resolve({ did: "did:plc:test" });
  }

  getBlob(_did: string, cid: string): Promise<string> {
    return Promise.resolve(`https://example.com/blob/${cid}`);
  }

  resolveBlobUrl(blobRef: string): string {
    return `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=test&cid=${blobRef}`;
  }

  refreshToken(): Promise<any> {
    return Promise.resolve({
      access_token: "new_token",
      refresh_token: "new_refresh_token",
      expires_in: 3600,
    });
  }
}

class TestMastodonClient implements MastodonHttpClient {
  public posts: any[] = [];
  public shouldFail = false;

  verifyCredentials(): Promise<any> {
    return Promise.resolve({ id: "1", username: "test" });
  }

  getAccount(): Promise<any> {
    return Promise.resolve({ id: "1", username: "test" });
  }

  getInstance(): Promise<any> {
    return Promise.resolve({ title: "Test Instance" });
  }

  uploadMedia(): Promise<any> {
    return Promise.resolve({
      id: "media_123",
      type: "image",
      url: "https://example.com/media.jpg",
    });
  }

  getMediaStatus(mediaId: string): Promise<any> {
    return Promise.resolve({
      id: mediaId,
      url: "https://example.com/media.jpg",
    });
  }

  createPost(params: any): Promise<any> {
    if (this.shouldFail) {
      return Promise.reject(new Error("Network error"));
    }
    const post = {
      id: String(this.posts.length + 1),
      uri: `https://example.com/posts/${this.posts.length + 1}`,
      url: `https://example.com/posts/${this.posts.length + 1}`,
      content: params.status,
      created_at: new Date().toISOString(),
    };
    this.posts.push(post);
    return Promise.resolve(post);
  }

  registerApp(): Promise<any> {
    return Promise.resolve({
      client_id: "test_client_id",
      client_secret: "test_client_secret",
    });
  }

  exchangeCodeForToken(): Promise<any> {
    return Promise.resolve({
      access_token: "test_token",
      token_type: "Bearer",
      scope: "read write",
    });
  }
}

// Helper functions
function createPost(
  uri: string,
  text: string,
  options: Partial<{
    reply: boolean;
    repost: boolean;
    mention: boolean;
    createdAt: string;
  }> = {},
): ATProtoPost {
  const post: ATProtoPost = {
    uri,
    cid: "test_cid",
    author: {
      did: "did:plc:test",
      handle: "test.bsky.social",
      displayName: "Test User",
    },
    record: {
      text,
      createdAt: options.createdAt || new Date().toISOString(),
      facets: [],
    },
    indexedAt: new Date().toISOString(),
  };

  if (options.reply) {
    post.record.reply = {
      root: { uri: "root-uri", cid: "root-cid" },
      parent: { uri: "parent-uri", cid: "parent-cid" },
    };
  }

  if (options.repost) {
    post.record.embed = { $type: "app.bsky.embed.record" };
  }

  if (options.mention) {
    post.record.facets = [{
      index: { byteStart: 0, byteEnd: text.indexOf(" ") },
      features: [{
        $type: "app.bsky.richtext.facet#mention",
        did: "did:plc:someone",
      }],
    }];
  }

  return post;
}

async function setupTestEnvironment(options: {
  setupComplete?: boolean;
  hasATProtoTokens?: boolean;
  hasMastodonTokens?: boolean;
} = {}) {
  const storage = new InMemoryStorageProvider();
  await storage.initialize();

  if (options.setupComplete !== false) {
    await storage.userAccounts.create();
    await storage.userAccounts.updateSingle({
      setup_completed: options.setupComplete ?? true,
      ...(options.hasATProtoTokens !== false && {
        atproto_access_token: "token",
        atproto_did: "did:plc:test",
        atproto_handle: "test.bsky.social",
      }),
      ...(options.hasMastodonTokens !== false && {
        mastodon_access_token: "token",
        mastodon_instance_url: "https://mastodon.social",
      }),
    });
  }

  return storage;
}

// Test 1: Setup validation
Deno.test("Step 1: Validate setup is complete", async (t) => {
  await t.step("no user account", async () => {
    const storage = await setupTestEnvironment({ setupComplete: false });
    const service = new SyncService({
      storage,
      createATProtoClient: () => new TestATProtoClient(),
      createMastodonClient: () => new TestMastodonClient(),
    });

    const result = await service.syncUser();
    assertEquals(result.success, false);
    assertEquals(result.errors[0].message, "User account not found");
  });

  await t.step("setup not completed", async () => {
    const storage = await setupTestEnvironment();
    await storage.userAccounts.updateSingle({ setup_completed: false });

    const service = new SyncService({
      storage,
      createATProtoClient: () => new TestATProtoClient(),
      createMastodonClient: () => new TestMastodonClient(),
    });

    const result = await service.syncUser();
    assertEquals(result.success, true);
    assertEquals(result.postsProcessed, 0);
  });

  await t.step("setup completed with all tokens", async () => {
    const storage = await setupTestEnvironment();
    const service = new SyncService({
      storage,
      createATProtoClient: () => new TestATProtoClient(),
      createMastodonClient: () => new TestMastodonClient(),
    });

    const result = await service.syncUser();
    assertEquals(result.success, true);
  });
});

// Test 2: Authentication validation
Deno.test("Step 2: Validate authentication", async (t) => {
  await t.step("missing access tokens (early check)", async () => {
    const storage = await setupTestEnvironment({
      hasATProtoTokens: false,
      hasMastodonTokens: false,
    });

    const service = new SyncService({
      storage,
      createATProtoClient: () => new TestATProtoClient(),
      createMastodonClient: () => new TestMastodonClient(),
    });

    const result = await service.syncUser();
    assertEquals(result.success, true); // Graceful handling
    assertEquals(result.postsProcessed, 0);
  });

  await t.step("missing ATProto DID", async () => {
    const storage = await setupTestEnvironment();
    await storage.userAccounts.updateSingle({
      atproto_did: null,
    });

    const service = new SyncService({
      storage,
      createATProtoClient: () => new TestATProtoClient(),
      createMastodonClient: () => new TestMastodonClient(),
    });

    const result = await service.syncUser();
    assertEquals(result.success, false);
    assertEquals(result.errors[0].message, "Missing ATProto credentials");
  });

  await t.step("missing Mastodon instance URL", async () => {
    const storage = await setupTestEnvironment();
    await storage.userAccounts.updateSingle({
      mastodon_instance_url: null,
    });

    const service = new SyncService({
      storage,
      createATProtoClient: () => new TestATProtoClient(),
      createMastodonClient: () => new TestMastodonClient(),
    });

    const result = await service.syncUser();
    assertEquals(result.success, false);
    assertEquals(result.errors[0].message, "Missing Mastodon credentials");
  });
});

// Test 3: Fetching posts
Deno.test("Step 3: Fetch ATProto posts", async (t) => {
  await t.step("fetch posts successfully", async () => {
    const storage = await setupTestEnvironment();
    const posts = [
      createPost("at://did:plc:test/app.bsky.feed.post/1", "Post 1"),
      createPost("at://did:plc:test/app.bsky.feed.post/2", "Post 2"),
    ];

    const atprotoClient = new TestATProtoClient(posts);
    let fetchCalled = false;
    const originalFetch = atprotoClient.fetchPosts.bind(atprotoClient);
    atprotoClient.fetchPosts = () => {
      fetchCalled = true;
      return originalFetch();
    };

    const service = new SyncService({
      storage,
      createATProtoClient: () => atprotoClient,
      createMastodonClient: () => new TestMastodonClient(),
    });

    const result = await service.syncUser();
    assertEquals(result.success, true);
    assertEquals(result.postsProcessed, 2);
    assertEquals(fetchCalled, true);
  });

  await t.step("handle empty feed", async () => {
    const storage = await setupTestEnvironment();
    const service = new SyncService({
      storage,
      createATProtoClient: () => new TestATProtoClient([]),
      createMastodonClient: () => new TestMastodonClient(),
    });

    const result = await service.syncUser();
    assertEquals(result.success, true);
    assertEquals(result.postsProcessed, 0);
  });
});

// Test 4: Post filtering
Deno.test("Step 4: Filter posts", async (t) => {
  await t.step("filter replies", async () => {
    const storage = await setupTestEnvironment();
    const posts = [
      createPost("at://test/1", "Regular post"),
      createPost("at://test/2", "Reply post", { reply: true }),
    ];

    const mastodonClient = new TestMastodonClient();
    const service = new SyncService({
      storage,
      createATProtoClient: () => new TestATProtoClient(posts),
      createMastodonClient: () => mastodonClient,
    });

    const result = await service.syncUser();
    assertEquals(result.postsProcessed, 2);
    assertEquals(mastodonClient.posts.length, 1);
    assertEquals(mastodonClient.posts[0].content, "Regular post");
  });

  await t.step("filter reposts", async () => {
    const storage = await setupTestEnvironment();
    const posts = [
      createPost("at://test/1", "Regular post"),
      createPost("at://test/2", "Repost", { repost: true }),
    ];

    const mastodonClient = new TestMastodonClient();
    const service = new SyncService({
      storage,
      createATProtoClient: () => new TestATProtoClient(posts),
      createMastodonClient: () => mastodonClient,
    });

    await service.syncUser();
    assertEquals(mastodonClient.posts.length, 1);
    assertEquals(mastodonClient.posts[0].content, "Regular post");
  });

  await t.step("filter mentions when skip_mentions enabled", async () => {
    const storage = await setupTestEnvironment();

    const posts = [
      createPost("at://test/1", "Regular post"),
      createPost("at://test/2", "@someone hello", { mention: true }),
    ];

    const mastodonClient = new TestMastodonClient();
    const service = new SyncService({
      storage,
      createATProtoClient: () => new TestATProtoClient(posts),
      createMastodonClient: () => mastodonClient,
    });

    await service.syncUser();
    assertEquals(mastodonClient.posts.length, 1);
    assertEquals(mastodonClient.posts[0].content, "Regular post");
  });
});

// Test 5: Sync to Mastodon
Deno.test("Step 5: Sync to Mastodon", async (t) => {
  await t.step("successful sync", async () => {
    const storage = await setupTestEnvironment();
    const posts = [
      createPost("at://test/1", "Post 1"),
      createPost("at://test/2", "Post 2"),
    ];

    const mastodonClient = new TestMastodonClient();
    const service = new SyncService({
      storage,
      createATProtoClient: () => new TestATProtoClient(posts),
      createMastodonClient: () => mastodonClient,
    });

    const result = await service.syncUser();
    assertEquals(result.success, true);
    assertEquals(result.postsSuccessful, 2);
    assertEquals(result.postsFailed, 0);

    // Verify posts were created
    assertEquals(mastodonClient.posts.length, 2);

    // Verify tracking records
    const tracked = await storage.postTracking.getRecent();
    assertEquals(tracked.length, 2);
    assertEquals(tracked[0].sync_status, "success");
  });

  await t.step("handle sync failure", async () => {
    const storage = await setupTestEnvironment();
    const posts = [createPost("at://test/1", "Post 1")];

    const mastodonClient = new TestMastodonClient();
    mastodonClient.shouldFail = true;

    const service = new SyncService({
      storage,
      createATProtoClient: () => new TestATProtoClient(posts),
      createMastodonClient: () => mastodonClient,
      retryConfig: {
        maxRetries: 0,
        baseDelay: 100,
        maxDelay: 1000,
        backoffFactor: 2,
      },
    });

    const result = await service.syncUser();
    assertEquals(result.success, true);
    assertEquals(result.postsSuccessful, 0);
    assertEquals(result.postsFailed, 1);
    assertEquals(result.errors[0].message, "Network error");

    // Verify tracking shows failure
    const failed = await storage.postTracking.getFailed();
    assertEquals(failed.length, 1);
    assertEquals(failed[0].error_message, "Network error");
  });

  await t.step("skip already synced posts", async () => {
    const storage = await setupTestEnvironment();

    // Pre-track a post
    await storage.postTracking.create({
      atproto_uri: "at://test/1",
      atproto_cid: "cid1",
      atproto_rkey: "1",
      content_hash: "hash1",
      atproto_created_at: Math.floor(Date.now() / 1000),
    });

    const posts = [
      createPost("at://test/1", "Already synced"),
      createPost("at://test/2", "New post"),
    ];

    const mastodonClient = new TestMastodonClient();
    const service = new SyncService({
      storage,
      createATProtoClient: () => new TestATProtoClient(posts),
      createMastodonClient: () => mastodonClient,
    });

    const result = await service.syncUser();
    assertEquals(result.postsSuccessful, 1);
    assertEquals(mastodonClient.posts.length, 1);
    assertEquals(mastodonClient.posts[0].content, "New post");
  });
});

// Test 6: Removed - sync enabled/disabled is now handled by pausing the cron job
