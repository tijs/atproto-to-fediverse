import { ATProtoPost } from "../../shared/types.ts";
import { ATProtoValidator } from "./atproto-validator.ts";

export interface PostFilter {
  shouldSyncPost(post: ATProtoPost, settings: any): boolean;
}

/**
 * Filter that skips replies
 */
export class ReplyFilter implements PostFilter {
  shouldSyncPost(post: ATProtoPost, _settings: any): boolean {
    return !post.record.reply;
  }
}

/**
 * Filter that skips reposts and quote posts
 */
export class RepostFilter implements PostFilter {
  shouldSyncPost(post: ATProtoPost, _settings: any): boolean {
    if (post.record.embed) {
      const embedType = post.record.embed.$type;

      if (embedType === "app.bsky.embed.record") {
        console.log(
          `Skipping repost/quote post ${post.uri} (referenced content not available on Mastodon)`,
        );
        return false;
      }

      if (embedType === "app.bsky.embed.recordWithMedia") {
        console.log(
          `Skipping quote post with media ${post.uri} (referenced content not available on Mastodon)`,
        );
        return false;
      }
    }
    return true;
  }
}

/**
 * Filter that skips posts starting with mentions when enabled
 */
export class MentionFilter implements PostFilter {
  shouldSyncPost(post: ATProtoPost, settings: any): boolean {
    if (!settings?.skip_mentions) return true;

    const facets = post.record.facets;
    if (facets && facets.length > 0) {
      const text = post.record.text;
      const trimmedText = text.trimStart();

      // Calculate byte position of where actual content starts
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
        return false;
      }
    }
    return true;
  }
}

/**
 * Filter that skips invalid or empty posts
 */
export class ValidationFilter implements PostFilter {
  private validator = new ATProtoValidator();

  shouldSyncPost(post: ATProtoPost, _settings: any): boolean {
    // Validate post structure first
    const validation = this.validator.validateATProtoPost(post);
    if (!validation.valid) {
      console.warn(`Skipping invalid post ${post.uri}:`, validation.errors);
      return false;
    }

    // Skip if post has no content
    if (!post.record.text.trim() && !post.record.embed) {
      return false;
    }

    return true;
  }
}

/**
 * Default filter that combines all standard filtering rules
 */
export class DefaultPostFilter implements PostFilter {
  private filters: PostFilter[] = [
    new ValidationFilter(),
    new ReplyFilter(),
    new RepostFilter(),
    new MentionFilter(),
  ];

  shouldSyncPost(post: ATProtoPost, settings: any): boolean {
    return this.filters.every((filter) =>
      filter.shouldSyncPost(post, settings)
    );
  }

  /**
   * Get the individual filters for inspection or modification
   */
  getFilters(): PostFilter[] {
    return [...this.filters];
  }

  /**
   * Add an additional filter
   */
  addFilter(filter: PostFilter): void {
    this.filters.push(filter);
  }
}

export class PostFilterManager {
  private filters: PostFilter[];

  constructor(filters: PostFilter[] = [new DefaultPostFilter()]) {
    this.filters = filters;
  }

  /**
   * Add a custom filter to the chain
   */
  addFilter(filter: PostFilter): void {
    this.filters.push(filter);
  }

  /**
   * Check if a post should be synced based on all active filters
   */
  shouldSyncPost(post: ATProtoPost, settings: any): boolean {
    return this.filters.every((filter) =>
      filter.shouldSyncPost(post, settings)
    );
  }

  /**
   * Remove all filters and add new ones
   */
  setFilters(filters: PostFilter[]): void {
    this.filters = filters;
  }

  /**
   * Get current filters
   */
  getFilters(): PostFilter[] {
    return [...this.filters];
  }
}
