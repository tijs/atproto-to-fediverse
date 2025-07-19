// Unit tests for SyncService using dependency injection

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { InMemoryStorageProvider } from "../backend/storage/memory-storage.ts";
import { SyncService } from "../backend/services/sync-service.ts";
import {
  ATProtoHttpClient,
  MastodonHttpClient,
} from "../backend/interfaces/http-client.ts";
import { ATProtoPost } from "../shared/types.ts";

// Mock ATProto client
class MockATProtoClient implements ATProtoHttpClient {
  private posts: ATProtoPost[] = [];

  constructor(posts: ATProtoPost[] = []) {
    this.posts = posts;
  }

  fetchPosts(
    _params: { actor: string; limit: number; cursor?: string },
  ): Promise<any> {
    return Promise.resolve({
      feed: this.posts.map((post) => ({ post })),
      cursor: undefined,
    });
  }

  getPost(uri: string): Promise<any> {
    const post = this.posts.find((p) => p.uri === uri);
    return Promise.resolve(post ? { thread: { post } } : null);
  }

  getProfile(_actor: string): Promise<any> {
    return Promise.resolve({ did: _actor, handle: "test.bsky.social" });
  }

  resolveHandle(_handle: string): Promise<any> {
    return Promise.resolve({ did: "did:plc:test" });
  }

  getBlob(_did: string, cid: string): Promise<string> {
    return Promise.resolve(`https://example.com/blob/${cid}`);
  }

  resolveBlobUrl(blobRef: string): string {
    return `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=test&cid=${blobRef}`;
  }

  refreshToken(_refreshToken: string): Promise<any> {
    return Promise.resolve({
      access_token: "new_token",
      refresh_token: "new_refresh_token",
      expires_in: 3600,
    });
  }
}

// Mock Mastodon client
class MockMastodonClient implements MastodonHttpClient {
  private shouldFail = false;
  private posts: any[] = [];

  setFailure(shouldFail: boolean) {
    this.shouldFail = shouldFail;
  }

  verifyCredentials(): Promise<any> {
    return Promise.resolve({ id: "1", username: "test" });
  }

  getAccount(): Promise<any> {
    return Promise.resolve({ id: "1", username: "test" });
  }

  getInstance(): Promise<any> {
    return Promise.resolve({ title: "Test Instance" });
  }

  uploadMedia(_file: Blob, description?: string): Promise<any> {
    if (this.shouldFail) {
      return Promise.reject(new Error("Media upload failed"));
    }
    return Promise.resolve({
      id: "media_123",
      type: "image",
      url: "https://example.com/media.jpg",
      description,
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
      return Promise.reject(new Error("Post creation failed"));
    }

    const post = {
      id: String(this.posts.length + 1),
      uri: `https://example.com/posts/${this.posts.length + 1}`,
      url: `https://example.com/posts/${this.posts.length + 1}`,
      content: params.status,
      created_at: new Date().toISOString(),
      media_attachments: params.media_ids?.map((id: string) => ({ id })) || [],
    };

    this.posts.push(post);
    return Promise.resolve(post);
  }

  registerApp(_params: any): Promise<any> {
    return Promise.resolve({
      client_id: "test_client_id",
      client_secret: "test_client_secret",
    });
  }

  exchangeCodeForToken(_params: any): Promise<any> {
    return Promise.resolve({
      access_token: "test_token",
      token_type: "Bearer",
      scope: "read write",
    });
  }

  getCreatedPosts() {
    return this.posts;
  }
}

// Test helper to create sample ATProto post
function createSamplePost(
  uri: string,
  text: string,
  createdAt: string,
): ATProtoPost {
  return {
    uri,
    cid: "test_cid",
    author: {
      did: "did:plc:test",
      handle: "test.custom-pds.example.com",
      displayName: "Test User",
    },
    record: {
      text,
      createdAt,
      facets: [],
    },
    indexedAt: createdAt,
  };
}

Deno.test("SyncService - should sync posts successfully", async () => {
  // Setup
  const storage = new InMemoryStorageProvider();
  await storage.initialize();

  const _account = await storage.userAccounts.create();
  await storage.userAccounts.updateSingle({
    setup_completed: true,
    atproto_access_token: "token",
    atproto_pds_url: "https://custom-pds.example.com",
    atproto_did: "did:plc:test",
    mastodon_access_token: "token",
    mastodon_instance_url: "https://mastodon.social",
  });

  await storage.settings.create();

  // Create mock clients
  const now = new Date();
  const posts = [
    createSamplePost(
      "at://did:plc:test/app.bsky.feed.post/1",
      "Hello world!",
      now.toISOString(),
    ),
    createSamplePost(
      "at://did:plc:test/app.bsky.feed.post/2",
      "Another post",
      new Date(now.getTime() + 1000).toISOString(),
    ),
  ];

  const mockATProtoClient = new MockATProtoClient(posts);
  const mockMastodonClient = new MockMastodonClient();

  // Create service
  const syncService = new SyncService({
    storage,
    createATProtoClient: (
      _pdsUrl: string,
      _accessToken: string,
      _refreshToken: string,
      _did: string,
    ) => mockATProtoClient,
    createMastodonClient: () => mockMastodonClient,
  });

  // Execute
  const result = await syncService.syncUser();

  // Verify
  assertEquals(result.success, true);
  assertEquals(result.postsProcessed, 2);
  assertEquals(result.postsSuccessful, 2);
  assertEquals(result.postsFailed, 0);

  // Check that posts were tracked
  const trackedPosts = await storage.postTracking.getRecent();
  assertEquals(trackedPosts.length, 2);
  assertEquals(trackedPosts[0].sync_status, "success");
  assertEquals(trackedPosts[1].sync_status, "success");

  // Check that posts were created on Mastodon
  const mastodonPosts = mockMastodonClient.getCreatedPosts();
  assertEquals(mastodonPosts.length, 2);
  assertEquals(mastodonPosts[0].content, "Hello world!");
  assertEquals(mastodonPosts[1].content, "Another post");
});

Deno.test("SyncService - should handle post creation failures", async () => {
  // Setup
  const storage = new InMemoryStorageProvider();
  await storage.initialize();

  await storage.userAccounts.create();
  await storage.userAccounts.updateSingle({
    setup_completed: true,
    atproto_access_token: "token",
    atproto_pds_url: "https://custom-pds.example.com",
    atproto_did: "did:plc:test",
    mastodon_access_token: "token",
    mastodon_instance_url: "https://mastodon.social",
  });

  await storage.settings.create();

  // Create mock clients with failure
  const posts = [
    createSamplePost(
      "at://did:plc:test/app.bsky.feed.post/1",
      "Hello world!",
      new Date().toISOString(),
    ),
  ];

  const mockATProtoClient = new MockATProtoClient(posts);
  const mockMastodonClient = new MockMastodonClient();
  mockMastodonClient.setFailure(true); // Make it fail

  // Create service with no retries to speed up test
  const syncService = new SyncService({
    storage,
    createATProtoClient: (
      _pdsUrl: string,
      _accessToken: string,
      _refreshToken: string,
      _did: string,
    ) => mockATProtoClient,
    createMastodonClient: () => mockMastodonClient,
    retryConfig: {
      maxRetries: 0,
      baseDelay: 100,
      maxDelay: 1000,
      backoffFactor: 2,
    },
  });

  // Execute
  const result = await syncService.syncUser();

  // Verify
  assertEquals(result.success, true); // Sync completes even with failures
  assertEquals(result.postsProcessed, 1);
  assertEquals(result.postsSuccessful, 0);
  assertEquals(result.postsFailed, 1);
  assertEquals(result.errors.length, 1);
  assertEquals(result.errors[0].message, "Post creation failed");

  // Check that post was marked as failed
  const failedPosts = await storage.postTracking.getFailed();
  assertEquals(failedPosts.length, 1);
  assertEquals(failedPosts[0].sync_status, "failed");
  assertEquals(failedPosts[0].error_message, "Post creation failed");
});

Deno.test("SyncService - should skip posts that already exist", async () => {
  // Setup
  const storage = new InMemoryStorageProvider();
  await storage.initialize();

  await storage.userAccounts.create();
  await storage.userAccounts.updateSingle({
    setup_completed: true,
    atproto_access_token: "token",
    atproto_pds_url: "https://custom-pds.example.com",
    atproto_did: "did:plc:test",
    mastodon_access_token: "token",
    mastodon_instance_url: "https://mastodon.social",
  });

  await storage.settings.create();

  // Pre-create a post tracking record
  const postUri = "at://did:plc:test/app.bsky.feed.post/1";
  await storage.postTracking.create({
    atproto_uri: postUri,
    atproto_cid: "test_cid",
    atproto_rkey: "1",
    content_hash: "test_hash",
    atproto_created_at: Math.floor(Date.now() / 1000),
  });

  // Create mock clients
  const posts = [
    createSamplePost(postUri, "Hello world!", new Date().toISOString()),
  ];

  const mockATProtoClient = new MockATProtoClient(posts);
  const mockMastodonClient = new MockMastodonClient();

  // Create service
  const syncService = new SyncService({
    storage,
    createATProtoClient: (
      _pdsUrl: string,
      _accessToken: string,
      _refreshToken: string,
      _did: string,
    ) => mockATProtoClient,
    createMastodonClient: () => mockMastodonClient,
  });

  // Execute
  const result = await syncService.syncUser();

  // Verify
  assertEquals(result.success, true);
  assertEquals(result.postsProcessed, 1);
  assertEquals(result.postsSuccessful, 0); // Should be 0 because post was skipped
  assertEquals(result.postsFailed, 0);

  // Check that no new posts were created on Mastodon
  const mastodonPosts = mockMastodonClient.getCreatedPosts();
  assertEquals(mastodonPosts.length, 0);
});

Deno.test("SyncService - should handle missing user account", async () => {
  // Setup
  const storage = new InMemoryStorageProvider();
  await storage.initialize();

  const mockATProtoClient = new MockATProtoClient();
  const mockMastodonClient = new MockMastodonClient();

  // Create service
  const syncService = new SyncService({
    storage,
    createATProtoClient: (
      _pdsUrl: string,
      _accessToken: string,
      _refreshToken: string,
      _did: string,
    ) => mockATProtoClient,
    createMastodonClient: () => mockMastodonClient,
  });

  // Execute
  const result = await syncService.syncUser();

  // Verify
  assertEquals(result.success, false);
  assertEquals(result.errors.length, 1);
  assertEquals(result.errors[0].message, "User account not found");
});

Deno.test("SyncService - should respect sync disabled setting", async () => {
  // Setup
  const storage = new InMemoryStorageProvider();
  await storage.initialize();

  await storage.userAccounts.create();
  await storage.userAccounts.updateSingle({
    setup_completed: true,
    atproto_access_token: "token",
    atproto_pds_url: "https://custom-pds.example.com",
    atproto_did: "did:plc:test",
    mastodon_access_token: "token",
    mastodon_instance_url: "https://mastodon.social",
  });

  // Create settings with sync disabled
  await storage.settings.create();
  await storage.settings.updateSingle({ sync_enabled: false });

  // Create mock clients
  const posts = [
    createSamplePost(
      "at://did:plc:test/app.bsky.feed.post/1",
      "Hello world!",
      "2024-01-01T10:00:00Z",
    ),
  ];

  const mockATProtoClient = new MockATProtoClient(posts);
  const mockMastodonClient = new MockMastodonClient();

  // Create service
  const syncService = new SyncService({
    storage,
    createATProtoClient: (
      _pdsUrl: string,
      _accessToken: string,
      _refreshToken: string,
      _did: string,
    ) => mockATProtoClient,
    createMastodonClient: () => mockMastodonClient,
  });

  // Execute
  const result = await syncService.syncUser();

  // Verify
  assertEquals(result.success, true);
  assertEquals(result.postsProcessed, 0); // Should be 0 because sync is disabled
  assertEquals(result.postsSuccessful, 0);
  assertEquals(result.postsFailed, 0);

  // Check that no posts were created on Mastodon
  const mastodonPosts = mockMastodonClient.getCreatedPosts();
  assertEquals(mastodonPosts.length, 0);
});

// Run tests: deno test --allow-read --allow-write tests/sync-service.test.ts
