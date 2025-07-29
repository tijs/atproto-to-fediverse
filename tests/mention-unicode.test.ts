import { assertEquals } from "https://deno.land/std@0.200.0/assert/mod.ts";
import { DefaultPostFilter } from "../backend/services/post-filter.ts";

// Helper to create test posts
function createPost(text: string, facets: any[] = []) {
  return {
    uri: "at://did:plc:test/app.bsky.feed.post/test123",
    cid: "test-cid",
    indexedAt: "2024-01-01T10:00:00Z",
    author: {
      did: "did:plc:test",
      handle: "test.bsky.social",
      displayName: "Test User",
      avatar: "https://example.com/avatar.jpg",
    },
    record: {
      text,
      createdAt: "2024-01-01T10:00:00Z",
      facets,
    },
  };
}

Deno.test("PostTransformer - should handle Unicode correctly when detecting mentions at start", () => {
  const testCases = [
    {
      name: "emoji before mention",
      text: "👋 @user.bsky.social hello",
      facets: [{
        index: { byteStart: 5, byteEnd: 20 }, // emoji (4 bytes) + space (1 byte) = 5
        features: [{
          $type: "app.bsky.richtext.facet#mention",
          did: "did:plc:user",
        }],
      }],
      shouldSkip: false, // Doesn't start with mention
    },
    {
      name: "multi-byte Unicode before mention",
      text: "🇺🇸 @user.bsky.social test",
      facets: [{
        index: { byteStart: 9, byteEnd: 24 }, // flag emoji (8 bytes) + space (1 byte) = 9
        features: [{
          $type: "app.bsky.richtext.facet#mention",
          did: "did:plc:user",
        }],
      }],
      shouldSkip: false,
    },
    {
      name: "Japanese character before mention",
      text: "こんにちは @user.bsky.social",
      facets: [{
        index: { byteStart: 16, byteEnd: 31 }, // 5 Japanese chars (3 bytes each) + space = 16
        features: [{
          $type: "app.bsky.richtext.facet#mention",
          did: "did:plc:user",
        }],
      }],
      shouldSkip: false,
    },
    {
      name: "mention at very start",
      text: "@user.bsky.social hello",
      facets: [{
        index: { byteStart: 0, byteEnd: 17 },
        features: [{
          $type: "app.bsky.richtext.facet#mention",
          did: "did:plc:user",
        }],
      }],
      shouldSkip: true,
    },
    {
      name: "mention after newline",
      text: "Hello\n@user.bsky.social test",
      facets: [{
        index: { byteStart: 6, byteEnd: 23 }, // "Hello" (5) + newline (1) = 6
        features: [{
          $type: "app.bsky.richtext.facet#mention",
          did: "did:plc:user",
        }],
      }],
      shouldSkip: false, // Doesn't start with mention, just has one after newline
    },
    {
      name: "mention with tab whitespace",
      text: "\t@user.bsky.social hello",
      facets: [{
        index: { byteStart: 1, byteEnd: 18 }, // tab is 1 byte
        features: [{
          $type: "app.bsky.richtext.facet#mention",
          did: "did:plc:user",
        }],
      }],
      shouldSkip: true, // Starts with mention after whitespace
    },
    {
      name: "zero-width space before mention",
      text: "​@user.bsky.social hello", // Contains zero-width space (U+200B)
      facets: [{
        index: { byteStart: 3, byteEnd: 20 }, // zero-width space is 3 bytes in UTF-8
        features: [{
          $type: "app.bsky.richtext.facet#mention",
          did: "did:plc:user",
        }],
      }],
      shouldSkip: false, // Zero-width space is not trimmed by trimStart()
    },
  ];

  for (const testCase of testCases) {
    const post = createPost(testCase.text, testCase.facets);
    const filter = new DefaultPostFilter();
    const result = !filter.shouldSyncPost(post, {
      skip_mentions: true,
    });

    assertEquals(
      result,
      testCase.shouldSkip,
      `${testCase.name}: expected shouldSkip=${testCase.shouldSkip}, got ${result}`,
    );
  }
});

Deno.test("PostTransformer - should correctly calculate byte positions for various Unicode scenarios", () => {
  // This test verifies our byte position calculation is correct
  const textEncoder = new TextEncoder();

  const testStrings = [
    { text: "👋", expectedBytes: 4 },
    { text: "🇺🇸", expectedBytes: 8 },
    { text: "こんにちは", expectedBytes: 15 }, // 5 chars × 3 bytes each
    { text: "​", expectedBytes: 3 }, // zero-width space
    { text: " ", expectedBytes: 1 }, // regular space
    { text: "\t", expectedBytes: 1 }, // tab
    { text: "\n", expectedBytes: 1 }, // newline
  ];

  for (const test of testStrings) {
    const bytes = textEncoder.encode(test.text).length;
    assertEquals(
      bytes,
      test.expectedBytes,
      `"${test.text}" should be ${test.expectedBytes} bytes`,
    );
  }
});
