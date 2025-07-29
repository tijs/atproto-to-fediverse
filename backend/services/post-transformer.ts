import { RichText } from "https://esm.sh/@atproto/api@0.15.23";
import { ATProtoPost, PostTransformation } from "../../shared/types.ts";
import { ATProtoValidator } from "./atproto-validator.ts";

export class PostTransformer {
  private static validator = new ATProtoValidator();

  /**
   * Transform an ATProto post to a format suitable for Mastodon
   */
  static transformPost(post: ATProtoPost): PostTransformation {
    // Validate the post before processing
    const validation = this.validator.validateATProtoPost(post);
    if (!validation.valid) {
      console.warn(
        `Post validation failed for ${post.uri}:`,
        validation.errors,
      );
      // Continue with sanitized post
      post = this.validator.sanitizePost(post);
    }
    const { record } = post;
    const mentions: PostTransformation["mentions"] = [];
    const links: PostTransformation["links"] = [];
    const hashtags: string[] = [];
    const media: PostTransformation["media"] = [];

    // Use RichText for proper facet processing
    const richText = new RichText({
      text: record.text,
      facets: record.facets,
    });

    // Transform the text with RichText formatting
    let transformedText = "";
    let footnoteCounter = 1;

    for (const segment of richText.segments()) {
      if (segment.isMention() && segment.mention) {
        // Convert mention to Bluesky profile URL
        const handle = segment.text.replace("@", "");
        // Use DID if available for more reliable profile URLs
        // DIDs work across all PDS instances, handles might change
        const did = segment.mention.did;
        const profileUrl = did
          ? `https://bsky.app/profile/${did}`
          : `https://bsky.app/profile/${handle}`;
        mentions.push({ handle, profileUrl });
        // Use footnote-style reference: @handle (1)
        transformedText += `@${handle} (${footnoteCounter})`;
        footnoteCounter++;
      } else if (segment.isLink() && segment.link) {
        // Keep the original link
        links.push({
          url: segment.link.uri,
          displayText: segment.text,
        });
        transformedText += segment.text;
      } else if (segment.isTag() && segment.tag) {
        // Keep hashtag as-is
        hashtags.push(segment.tag.tag);
        transformedText += segment.text;
      } else {
        // Plain text segment
        transformedText += segment.text;
      }
    }

    // Process media embeds
    if (record.embed) {
      switch (record.embed.$type) {
        case "app.bsky.embed.images":
          if (record.embed.images) {
            for (const image of record.embed.images) {
              media.push({
                url: `blob://${image.image.ref}`, // Will be resolved to actual URL later
                type: "image",
                description: image.alt || "",
              });
            }
          }
          break;

        case "app.bsky.embed.video":
          if (record.embed.video) {
            media.push({
              url: `blob://${record.embed.video.ref}`, // Will be resolved to actual URL later
              type: "video",
              description: "",
            });
          }
          break;

        case "app.bsky.embed.external":
          // Add external link preview information
          if (record.embed.external) {
            const external = record.embed.external;
            // Add the external URL if not already in links
            const externalUrl = external.uri;
            if (!links.some((link) => link.url === externalUrl)) {
              links.push({
                url: externalUrl,
                displayText: external.title || externalUrl,
              });
            }
            // Note: Mastodon will generate its own preview, so we don't need to handle description/thumb
          }
          break;
      }
    }

    return {
      text: transformedText.trim(),
      media,
      mentions,
      links,
      hashtags,
    };
  }

  /**
   * Generate a content hash for duplicate detection
   */
  static generateContentHash(post: ATProtoPost): string {
    const content = {
      text: post.record.text,
      createdAt: post.record.createdAt,
      author: post.author.did,
      embed: post.record.embed ? JSON.stringify(post.record.embed) : null,
    };

    return this.hashString(JSON.stringify(content));
  }

  /**
   * Simple hash function for content
   */
  private static hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }

  /**
   * Check if a post should be skipped (replies, invalid data, etc.)
   */
  static shouldSkipPost(
    post: ATProtoPost,
    settings?: { skip_mentions?: boolean },
  ): boolean {
    // Validate post structure first
    const validation = this.validator.validateATProtoPost(post);
    if (!validation.valid) {
      console.warn(`Skipping invalid post ${post.uri}:`, validation.errors);
      return true;
    }

    // Skip replies (posts with reply references)
    if (post.record.reply) {
      return true;
    }

    // Skip reposts and quote posts (posts that reference another post)
    if (post.record.embed) {
      const embedType = post.record.embed.$type;

      // Check for direct record embeds (reposts/quotes without media)
      if (embedType === "app.bsky.embed.record") {
        console.log(
          `Skipping repost/quote post ${post.uri} (referenced content not available on Mastodon)`,
        );
        return true;
      }

      // Check for recordWithMedia embeds (quotes with media like images/video)
      if (embedType === "app.bsky.embed.recordWithMedia") {
        console.log(
          `Skipping quote post with media ${post.uri} (referenced content not available on Mastodon)`,
        );
        return true;
      }
    }

    // Skip posts that start with mentions (conversation starters) if enabled
    if (settings?.skip_mentions) {
      // Check if the post starts with a mention by examining facets
      const facets = post.record.facets;
      if (facets && facets.length > 0) {
        // Find the very first content in the post (after any initial whitespace)
        const text = post.record.text;
        const trimmedText = text.trimStart();

        // Calculate byte position of where actual content starts
        // We need to convert character positions to byte positions
        const textEncoder = new TextEncoder();
        const leadingWhitespaceChars = text.length - trimmedText.length;
        const leadingWhitespaceBytes = textEncoder.encode(
          text.substring(0, leadingWhitespaceChars),
        ).length;

        // Check if there's a mention facet that starts exactly at the beginning of actual content
        const mentionAtStart = facets.find((facet) =>
          facet.index.byteStart === leadingWhitespaceBytes &&
          facet.features?.some((feature: any) =>
            feature.$type === "app.bsky.richtext.facet#mention"
          )
        );

        if (mentionAtStart) {
          console.log(
            `Skipping mention post ${post.uri} (starts with @handle)`,
          );
          return true;
        }
      }
    }

    // Skip if post has no content
    if (!post.record.text.trim() && !post.record.embed) {
      return true;
    }

    return false;
  }

  /**
   * Validate post structure and return validation results
   */
  static validatePost(post: ATProtoPost): { valid: boolean; errors: string[] } {
    return this.validator.validateATProtoPost(post);
  }

  /**
   * Resolve blob URLs using ATProto client
   */
  static resolveBlobUrls(
    transformation: PostTransformation,
    atprotoClient: { resolveBlobUrl: (blobRef: string) => string },
  ): PostTransformation {
    const resolvedMedia = transformation.media.map((item) => {
      if (item.url.startsWith("blob://")) {
        const blobRef = item.url.replace("blob://", "");
        try {
          // Use the official API to construct blob URLs
          const resolvedUrl = atprotoClient.resolveBlobUrl(blobRef);
          return {
            ...item,
            url: resolvedUrl,
          };
        } catch (error) {
          console.error("Failed to resolve blob URL:", error);
          return item;
        }
      }
      return item;
    });

    return {
      ...transformation,
      media: resolvedMedia,
    };
  }

  /**
   * Get blob data for media uploads using ATProto client
   */
  static async getBlobsForUpload(
    transformation: PostTransformation,
    atprotoClient: { getBlob: (blobRef: string) => Promise<Blob> },
  ): Promise<PostTransformation & { blobData: Blob[] }> {
    const blobData: Blob[] = [];

    for (const item of transformation.media) {
      if (item.url.startsWith("blob://")) {
        const blobRef = item.url.replace("blob://", "");
        try {
          const blob = await atprotoClient.getBlob(blobRef);
          blobData.push(blob);
        } catch (error) {
          console.error("Failed to get blob data:", error);
          // Add empty blob as placeholder
          blobData.push(new Blob());
        }
      } else {
        // For non-blob URLs, we'd need to fetch them
        blobData.push(new Blob());
      }
    }

    return {
      ...transformation,
      blobData,
    };
  }

  /**
   * Format post for Mastodon (respecting character limits)
   */
  static formatForMastodon(transformation: PostTransformation): {
    status: string;
    media: PostTransformation["media"];
  } {
    let status = transformation.text;

    // Replace display text with actual URLs to ensure links are clickable
    // This handles cases where Bluesky truncates URLs with ellipsis
    for (const link of transformation.links) {
      // Replace the display text with the actual URL
      // This ensures full URLs are used even if display text was truncated
      status = status.replace(link.displayText, link.url);
    }

    // Add footnotes for mentions at the bottom
    if (transformation.mentions.length > 0) {
      status += "\n";
      transformation.mentions.forEach((mention, index) => {
        status += `\n(${index + 1}) ${mention.profileUrl}`;
      });
    }

    // Mastodon has a 500 character limit by default
    // If post is too long, truncate and add indication
    const maxLength = 500;
    if (status.length > maxLength) {
      status = status.substring(0, maxLength - 4) + "...";
    }

    return {
      status,
      media: transformation.media,
    };
  }
}
