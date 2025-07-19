// Unit tests for ATProtoValidator

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { ATProtoValidator } from "../backend/services/atproto-validator.ts";
import { ATProtoPost } from "../shared/types.ts";

// Test helper to create sample ATProto post
function createSamplePost(overrides: Partial<ATProtoPost> = {}): ATProtoPost {
  return {
    uri: "at://did:plc:test/app.bsky.feed.post/1",
    cid: "test_cid",
    author: {
      did: "did:plc:test",
      handle: "test.custom-pds.example.com",
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

Deno.test("ATProtoValidator - should validate a basic post", () => {
  const validator = new ATProtoValidator();
  const post = createSamplePost();

  const result = validator.validateATProtoPost(post);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
});

Deno.test("ATProtoValidator - should reject post with missing URI", () => {
  const validator = new ATProtoValidator();
  const post = createSamplePost({ uri: "" });

  const result = validator.validateATProtoPost(post);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((error) => error.includes("URI")), true);
});

Deno.test("ATProtoValidator - should reject post with missing author DID", () => {
  const validator = new ATProtoValidator();
  const post = createSamplePost({
    author: {
      did: "",
      handle: "test.custom-pds.example.com",
      displayName: "Test User",
    },
  });

  const result = validator.validateATProtoPost(post);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((error) => error.includes("DID")), true);
});

Deno.test("ATProtoValidator - should reject post with invalid createdAt", () => {
  const validator = new ATProtoValidator();
  const post = createSamplePost({
    record: {
      text: "Hello world!",
      createdAt: "invalid-date",
      facets: [],
    },
  });

  const result = validator.validateATProtoPost(post);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((error) => error.includes("datetime")), true);
});

Deno.test("ATProtoValidator - should validate post with mentions", () => {
  const validator = new ATProtoValidator();
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

  const result = validator.validateATProtoPost(post);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
});

Deno.test("ATProtoValidator - should reject mention with missing DID", () => {
  const validator = new ATProtoValidator();
  const post = createSamplePost({
    record: {
      text: "Hello @alice.bsky.social!",
      createdAt: "2024-01-01T10:00:00Z",
      facets: [{
        index: { byteStart: 6, byteEnd: 24 },
        features: [{
          $type: "app.bsky.richtext.facet#mention",
          // missing did
        }],
      }],
    },
  });

  const result = validator.validateATProtoPost(post);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.some((error) =>
      error.includes("mention") && error.includes("did")
    ),
    true,
  );
});

Deno.test("ATProtoValidator - should validate post with hashtags", () => {
  const validator = new ATProtoValidator();
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

  const result = validator.validateATProtoPost(post);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
});

Deno.test("ATProtoValidator - should validate post with links", () => {
  const validator = new ATProtoValidator();
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

  const result = validator.validateATProtoPost(post);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
});

Deno.test("ATProtoValidator - should reject facet with invalid index", () => {
  const validator = new ATProtoValidator();
  const post = createSamplePost({
    record: {
      text: "Hello world!",
      createdAt: "2024-01-01T10:00:00Z",
      facets: [{
        index: { byteStart: 10, byteEnd: 5 }, // invalid: start > end
        features: [{
          $type: "app.bsky.richtext.facet#tag",
          tag: "test",
        }],
      }],
    },
  });

  const result = validator.validateATProtoPost(post);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.some((error) =>
      error.includes("byteStart") && error.includes("byteEnd")
    ),
    true,
  );
});

Deno.test("ATProtoValidator - should validate post with image embed", () => {
  const validator = new ATProtoValidator();
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

  const result = validator.validateATProtoPost(post);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
});

Deno.test("ATProtoValidator - should reject image embed with missing alt text", () => {
  const validator = new ATProtoValidator();
  const post = createSamplePost({
    record: {
      text: "Check out this image!",
      createdAt: "2024-01-01T10:00:00Z",
      embed: {
        $type: "app.bsky.embed.images",
        images: [{
          // missing alt text
          image: {
            ref: "blob_ref_123",
            mimeType: "image/jpeg",
            size: 1024000,
          },
        }],
      },
    },
  });

  const result = validator.validateATProtoPost(post);

  assertEquals(result.valid, false);
  assertEquals(result.errors.some((error) => error.includes("alt")), true);
});

Deno.test("ATProtoValidator - should reject post with empty text and no embed", () => {
  const validator = new ATProtoValidator();
  const post = createSamplePost({
    record: {
      text: "",
      createdAt: "2024-01-01T10:00:00Z",
      facets: [],
    },
  });

  const result = validator.validateATProtoPost(post);

  assertEquals(result.valid, false);
  assertEquals(
    result.errors.some((error) => error.includes("text content or an embed")),
    true,
  );
});

Deno.test("ATProtoValidator - should sanitize invalid post", () => {
  const validator = new ATProtoValidator();
  const invalidPost = {
    uri: "at://did:plc:test/app.bsky.feed.post/1",
    cid: "test_cid",
    author: {
      did: "did:plc:test",
      handle: "test.custom-pds.example.com",
    },
    record: {
      text: 123, // invalid type
      createdAt: "2024-01-01T10:00:00Z",
      facets: [{
        index: { byteStart: 10, byteEnd: 5 }, // invalid index
        features: [{
          $type: "app.bsky.richtext.facet#mention",
          // missing did
        }],
      }],
      embed: {
        $type: "app.bsky.embed.images",
        images: [], // invalid: empty array
      },
    },
    indexedAt: "2024-01-01T10:00:00Z",
  };

  const sanitized = validator.sanitizePost(invalidPost);

  // Text should be converted to string
  assertEquals(sanitized.record.text, "");

  // Invalid facets should be removed
  assertEquals(sanitized.record.facets.length, 0);

  // Invalid embed should be removed
  assertEquals(sanitized.record.embed, undefined);
});

Deno.test("ATProtoValidator - should validate record only", () => {
  const validator = new ATProtoValidator();
  const record = {
    text: "Hello world!",
    createdAt: "2024-01-01T10:00:00Z",
  };

  const result = validator.validatePost(record);

  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
});

// Run tests: deno test --allow-import tests/atproto-validator.test.ts
