// Unit tests for PostTransformer

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { PostTransformer } from "../backend/services/post-transformer.ts";
import { ATProtoPost } from "../shared/types.ts";

// Test helper to create sample ATProto post
function createSamplePost(overrides: Partial<ATProtoPost> = {}): ATProtoPost {
  return {
    uri: "at://did:plc:test/app.bsky.feed.post/1",
    cid: "test_cid",
    author: {
      did: "did:plc:test",
      handle: "test.bsky.social",
      displayName: "Test User",
    },
    record: {
      text: "Hello world!",
      createdAt: "2024-01-01T10:00:00Z",
      facets: [],
    },
    indexedAt: "2024-01-01T10:00:00Z",
    ...overrides,
  };
}

Deno.test("PostTransformer - should transform basic post", () => {
  const post = createSamplePost();

  const result = PostTransformer.transformPost(post);

  assertEquals(result.text, "Hello world!");
  assertEquals(result.media.length, 0);
  assertEquals(result.mentions.length, 0);
  assertEquals(result.links.length, 0);
  assertEquals(result.hashtags.length, 0);
});

Deno.test("PostTransformer - should transform mentions to profile links using DID", () => {
  const post = createSamplePost({
    record: {
      text: "Hello @alice.bsky.social!",
      createdAt: "2024-01-01T10:00:00Z",
      facets: [{
        index: { byteStart: 6, byteEnd: 24 },
        features: [{
          $type: "app.bsky.richtext.facet#mention",
          did: "did:plc:alice",
        }],
      }],
    },
  });

  const result = PostTransformer.transformPost(post);

  // Should use DID in profile URL when available
  assertEquals(
    result.text,
    "Hello https://bsky.app/profile/did:plc:alice!",
  );
  assertEquals(result.mentions.length, 1);
  assertEquals(result.mentions[0].handle, "alice.bsky.social");
  assertEquals(
    result.mentions[0].profileUrl,
    "https://bsky.app/profile/did:plc:alice",
  );
});

Deno.test("PostTransformer - should handle hashtags", () => {
  const post = createSamplePost({
    record: {
      text: "Hello #world!",
      createdAt: "2024-01-01T10:00:00Z",
      facets: [{
        index: { byteStart: 6, byteEnd: 12 },
        features: [{
          $type: "app.bsky.richtext.facet#tag",
          tag: "world",
        }],
      }],
    },
  });

  const result = PostTransformer.transformPost(post);

  assertEquals(result.text, "Hello #world!");
  assertEquals(result.hashtags.length, 1);
  assertEquals(result.hashtags[0], "world");
});

Deno.test("PostTransformer - should handle links", () => {
  const post = createSamplePost({
    record: {
      text: "Check out https://example.com",
      createdAt: "2024-01-01T10:00:00Z",
      facets: [{
        index: { byteStart: 10, byteEnd: 29 },
        features: [{
          $type: "app.bsky.richtext.facet#link",
          uri: "https://example.com",
        }],
      }],
    },
  });

  const result = PostTransformer.transformPost(post);

  assertEquals(result.text, "Check out https://example.com");
  assertEquals(result.links.length, 1);
  assertEquals(result.links[0].url, "https://example.com");
  assertEquals(result.links[0].displayText, "https://example.com");
});

Deno.test("PostTransformer - should handle image embeds", () => {
  const post = createSamplePost({
    record: {
      text: "Check out this image!",
      createdAt: "2024-01-01T10:00:00Z",
      embed: {
        $type: "app.bsky.embed.images",
        images: [{
          alt: "A beautiful sunset",
          image: {
            ref: "blob_ref_123",
            mimeType: "image/jpeg",
            size: 1024000,
          },
        }],
      },
    },
  });

  const result = PostTransformer.transformPost(post);

  assertEquals(result.text, "Check out this image!");
  assertEquals(result.media.length, 1);
  assertEquals(result.media[0].type, "image");
  assertEquals(result.media[0].url, "blob://blob_ref_123");
  assertEquals(result.media[0].description, "A beautiful sunset");
});

Deno.test("PostTransformer - should handle external embeds (link previews)", () => {
  const post = createSamplePost({
    record: {
      text: "Check out this article!",
      createdAt: "2024-01-01T10:00:00Z",
      embed: {
        $type: "app.bsky.embed.external",
        external: {
          uri: "https://example.com/article",
          title: "Great Article Title",
          description: "This is a preview of the article",
          thumb: {
            ref: "blob_ref_thumb",
            mimeType: "image/jpeg",
            size: 50000,
          },
        },
      },
    },
  });

  const result = PostTransformer.transformPost(post);

  assertEquals(result.text, "Check out this article!");
  assertEquals(result.links.length, 1);
  assertEquals(result.links[0].url, "https://example.com/article");
  assertEquals(result.links[0].displayText, "Great Article Title");
});

Deno.test("PostTransformer - should handle video embeds", () => {
  const post = createSamplePost({
    record: {
      text: "Check out this video!",
      createdAt: "2024-01-01T10:00:00Z",
      embed: {
        $type: "app.bsky.embed.video",
        video: {
          ref: "blob_ref_456",
          mimeType: "video/mp4",
          size: 5000000,
        },
      },
    },
  });

  const result = PostTransformer.transformPost(post);

  assertEquals(result.text, "Check out this video!");
  assertEquals(result.media.length, 1);
  assertEquals(result.media[0].type, "video");
  assertEquals(result.media[0].url, "blob://blob_ref_456");
});

Deno.test("PostTransformer - should generate consistent content hash", () => {
  const post1 = createSamplePost();
  const post2 = createSamplePost();

  const hash1 = PostTransformer.generateContentHash(post1);
  const hash2 = PostTransformer.generateContentHash(post2);

  assertEquals(hash1, hash2);
  assertEquals(typeof hash1, "string");
  assertEquals(hash1.length > 0, true);
});

Deno.test("PostTransformer - should generate different hashes for different content", () => {
  const post1 = createSamplePost({
    record: { text: "Hello world!", createdAt: "2024-01-01T10:00:00Z" },
  });
  const post2 = createSamplePost({
    record: { text: "Different text!", createdAt: "2024-01-01T10:00:00Z" },
  });

  const hash1 = PostTransformer.generateContentHash(post1);
  const hash2 = PostTransformer.generateContentHash(post2);

  assertEquals(hash1 !== hash2, true);
});

Deno.test("PostTransformer - should skip reply posts", () => {
  const post = createSamplePost({
    record: {
      text: "This is a reply",
      createdAt: "2024-01-01T10:00:00Z",
      reply: {
        root: {
          uri: "at://did:plc:test/app.bsky.feed.post/root",
          cid: "root_cid",
        },
        parent: {
          uri: "at://did:plc:test/app.bsky.feed.post/parent",
          cid: "parent_cid",
        },
      },
    },
  });

  const shouldSkip = PostTransformer.shouldSkipPost(post);

  assertEquals(shouldSkip, true);
});

Deno.test("PostTransformer - should skip empty posts", () => {
  const post = createSamplePost({
    record: {
      text: "",
      createdAt: "2024-01-01T10:00:00Z",
    },
  });

  const shouldSkip = PostTransformer.shouldSkipPost(post);

  assertEquals(shouldSkip, true);
});

Deno.test("PostTransformer - should skip reposts (shares without text)", () => {
  const post = createSamplePost({
    record: {
      text: "", // No additional text
      createdAt: "2024-01-01T10:00:00Z",
      embed: {
        $type: "app.bsky.embed.record",
        record: {
          uri: "at://did:plc:test/app.bsky.feed.post/original",
          cid: "original_cid",
        },
      },
    },
  });

  const shouldSkip = PostTransformer.shouldSkipPost(post);

  assertEquals(shouldSkip, true);
});

Deno.test("PostTransformer - should also skip quote posts with additional text", () => {
  const post = createSamplePost({
    record: {
      text: "This is my take on this post:",
      createdAt: "2024-01-01T10:00:00Z",
      embed: {
        $type: "app.bsky.embed.record",
        record: {
          uri: "at://did:plc:test/app.bsky.feed.post/original",
          cid: "original_cid",
        },
      },
    },
  });

  const shouldSkip = PostTransformer.shouldSkipPost(post);

  assertEquals(shouldSkip, true);
});

Deno.test("PostTransformer - should skip quote posts with media (recordWithMedia)", () => {
  const post = createSamplePost({
    record: {
      text: "Check out this quote with an image!",
      createdAt: "2024-01-01T10:00:00Z",
      embed: {
        $type: "app.bsky.embed.recordWithMedia",
        record: {
          uri: "at://did:plc:test/app.bsky.feed.post/original",
          cid: "original_cid",
        },
        images: [{
          alt: "My reaction image",
          image: {
            ref: "blob_ref_123",
            mimeType: "image/jpeg",
            size: 1024000,
          },
        }],
      },
    },
  });

  const shouldSkip = PostTransformer.shouldSkipPost(post);

  assertEquals(shouldSkip, true);
});

Deno.test("PostTransformer - should not skip regular posts", () => {
  const post = createSamplePost();

  const shouldSkip = PostTransformer.shouldSkipPost(post);

  assertEquals(shouldSkip, false);
});

Deno.test("PostTransformer - should format post for Mastodon", () => {
  const transformation = {
    text: "Hello world!",
    media: [],
    mentions: [],
    links: [],
    hashtags: [],
  };

  const result = PostTransformer.formatForMastodon(transformation);

  assertEquals(result.status, "Hello world!");
  assertEquals(result.media.length, 0);
});

Deno.test("PostTransformer - should truncate long posts for Mastodon", () => {
  const longText = "A".repeat(600); // Longer than 500 characters
  const transformation = {
    text: longText,
    media: [],
    mentions: [],
    links: [],
    hashtags: [],
  };

  const result = PostTransformer.formatForMastodon(transformation);

  assertEquals(result.status.length, 499);
  assertEquals(result.status.endsWith("..."), true);
});

Deno.test("PostTransformer - should handle complex post with multiple facets", () => {
  const post = createSamplePost({
    record: {
      text:
        "Hello @alice.bsky.social! Check out #bluesky and visit https://example.com",
      createdAt: "2024-01-01T10:00:00Z",
      facets: [
        {
          index: { byteStart: 6, byteEnd: 24 },
          features: [{
            $type: "app.bsky.richtext.facet#mention",
            did: "did:plc:alice",
          }],
        },
        {
          index: { byteStart: 35, byteEnd: 44 },
          features: [{
            $type: "app.bsky.richtext.facet#tag",
            tag: "bluesky",
          }],
        },
        {
          index: { byteStart: 55, byteEnd: 74 },
          features: [{
            $type: "app.bsky.richtext.facet#link",
            uri: "https://example.com",
          }],
        },
      ],
    },
  });

  const result = PostTransformer.transformPost(post);

  assertEquals(
    result.text,
    "Hello https://bsky.app/profile/did:plc:alice! Check out #bluesky and visit https://example.com",
  );
  assertEquals(result.mentions.length, 1);
  assertEquals(result.mentions[0].handle, "alice.bsky.social");
  assertEquals(
    result.mentions[0].profileUrl,
    "https://bsky.app/profile/did:plc:alice",
  );
  assertEquals(result.hashtags.length, 1);
  assertEquals(result.hashtags[0], "bluesky");
  assertEquals(result.links.length, 1);
  assertEquals(result.links[0].url, "https://example.com");
});

Deno.test("PostTransformer - should resolve blob URLs using ATProto client", () => {
  const transformation = {
    text: "Check out this image!",
    media: [{
      url: "blob://blob_ref_123",
      type: "image" as const,
      description: "A beautiful sunset",
    }],
    mentions: [],
    links: [],
    hashtags: [],
  };

  // Mock ATProto client
  const mockClient = {
    resolveBlobUrl: (blobRef: string) =>
      `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=did:plc:test&cid=${blobRef}`,
  };

  const result = PostTransformer.resolveBlobUrls(transformation, mockClient);

  assertEquals(result.text, "Check out this image!");
  assertEquals(result.media.length, 1);
  assertEquals(result.media[0].type, "image");
  assertEquals(
    result.media[0].url,
    "https://bsky.social/xrpc/com.atproto.sync.getBlob?did=did:plc:test&cid=blob_ref_123",
  );
  assertEquals(result.media[0].description, "A beautiful sunset");
});

Deno.test("PostTransformer - should get blob data for upload", async () => {
  const transformation = {
    text: "Check out this image!",
    media: [{
      url: "blob://blob_ref_123",
      type: "image" as const,
      description: "A beautiful sunset",
    }],
    mentions: [],
    links: [],
    hashtags: [],
  };

  // Mock ATProto client
  const mockClient = {
    getBlob: (blobRef: string) => {
      assertEquals(blobRef, "blob_ref_123");
      return Promise.resolve(
        new Blob(["fake image data"], { type: "image/jpeg" }),
      );
    },
  };

  const result = await PostTransformer.getBlobsForUpload(
    transformation,
    mockClient,
  );

  assertEquals(result.text, "Check out this image!");
  assertEquals(result.media.length, 1);
  assertEquals(result.blobData.length, 1);
  assertEquals(result.blobData[0].type, "image/jpeg");
});

Deno.test("PostTransformer - should replace display text with actual URLs in Mastodon formatting", () => {
  const transformation = {
    text: "Check out https://example.com for more info",
    media: [],
    mentions: [],
    links: [{
      url: "https://example.com/very/long/path/that/might/be/truncated",
      displayText: "https://example.com",
    }],
    hashtags: [],
  };

  const result = PostTransformer.formatForMastodon(transformation);

  assertEquals(
    result.status,
    "Check out https://example.com/very/long/path/that/might/be/truncated for more info",
  );
  assertEquals(result.media.length, 0);
});

Deno.test("PostTransformer - should handle truncated links with ellipsis", () => {
  const transformation = {
    text: "Check out https://example.com... for more info",
    media: [],
    mentions: [],
    links: [{
      url:
        "https://example.com/very/long/path/with/many/segments/that/was/truncated",
      displayText: "https://example.com...",
    }],
    hashtags: [],
  };

  const result = PostTransformer.formatForMastodon(transformation);

  assertEquals(
    result.status,
    "Check out https://example.com/very/long/path/with/many/segments/that/was/truncated for more info",
  );
});

Deno.test("PostTransformer - should handle multiple links in same post", () => {
  const transformation = {
    text: "Visit https://site1.com and https://site2.com...",
    media: [],
    mentions: [],
    links: [
      {
        url: "https://site1.com",
        displayText: "https://site1.com",
      },
      {
        url: "https://site2.com/long/path/here",
        displayText: "https://site2.com...",
      },
    ],
    hashtags: [],
  };

  const result = PostTransformer.formatForMastodon(transformation);

  assertEquals(
    result.status,
    "Visit https://site1.com and https://site2.com/long/path/here",
  );
});

Deno.test("PostTransformer - should handle links that don't need replacement", () => {
  const transformation = {
    text: "Check out https://short.link today",
    media: [],
    mentions: [],
    links: [{
      url: "https://short.link",
      displayText: "https://short.link",
    }],
    hashtags: [],
  };

  const result = PostTransformer.formatForMastodon(transformation);

  assertEquals(result.status, "Check out https://short.link today");
});

Deno.test("PostTransformer - should handle post with links and apply character limit after replacement", () => {
  const longText = "A".repeat(400);
  const transformation = {
    text: `${longText} Check out https://example.com... for details`,
    media: [],
    mentions: [],
    links: [{
      url:
        "https://example.com/extremely/long/path/that/will/make/the/post/exceed/character/limits/when/expanded",
      displayText: "https://example.com...",
    }],
    hashtags: [],
  };

  const result = PostTransformer.formatForMastodon(transformation);

  // Should truncate the expanded text to 500 chars
  assertEquals(result.status.length, 499);
  assertEquals(result.status.endsWith("..."), true);
  // Should contain the full URL before truncation
  assertEquals(
    result.status.includes("https://example.com/extremely/long/path"),
    true,
  );
});

Deno.test("PostTransformer - integration test: transform post with links and format for Mastodon", () => {
  const text =
    "Great article at https://example.com... and also check https://short.co";
  const firstLinkStart = text.indexOf("https://example.com...");
  const firstLinkEnd = firstLinkStart + "https://example.com...".length;
  const secondLinkStart = text.indexOf("https://short.co");
  const secondLinkEnd = secondLinkStart + "https://short.co".length;

  const post = createSamplePost({
    record: {
      text: text,
      createdAt: "2024-01-01T10:00:00Z",
      facets: [
        {
          index: { byteStart: firstLinkStart, byteEnd: firstLinkEnd },
          features: [{
            $type: "app.bsky.richtext.facet#link",
            uri: "https://example.com/full/path/to/article/with/very/long/url",
          }],
        },
        {
          index: { byteStart: secondLinkStart, byteEnd: secondLinkEnd },
          features: [{
            $type: "app.bsky.richtext.facet#link",
            uri: "https://short.co",
          }],
        },
      ],
    },
  });

  const transformation = PostTransformer.transformPost(post);
  const mastodonPost = PostTransformer.formatForMastodon(transformation);

  // Should have extracted links correctly
  assertEquals(transformation.links.length, 2);
  assertEquals(
    transformation.links[0].url,
    "https://example.com/full/path/to/article/with/very/long/url",
  );
  assertEquals(transformation.links[0].displayText, "https://example.com...");
  assertEquals(transformation.links[1].url, "https://short.co");
  assertEquals(transformation.links[1].displayText, "https://short.co");

  // Should have replaced display text with full URLs in final output
  assertEquals(
    mastodonPost.status,
    "Great article at https://example.com/full/path/to/article/with/very/long/url and also check https://short.co",
  );
});

// Run tests: deno test --allow-read --allow-write tests/post-transformer.test.ts
