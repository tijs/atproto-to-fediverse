import { ATProtoPost } from "../../shared/types.ts";

/**
 * ATProto data validation service using practical validation rules
 */
export class ATProtoValidator {
  /**
   * Validate an ATProto post record
   */
  validatePost(record: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Basic required fields
    if (record.text === undefined) {
      errors.push("Post record must have a text field");
    }

    if (record.createdAt === undefined) {
      errors.push("Post record must have a createdAt field");
    }

    // Type validations
    if (record.text !== undefined && typeof record.text !== "string") {
      errors.push("Post text must be a string");
    }

    if (
      record.createdAt !== undefined && !this.isValidDateTime(record.createdAt)
    ) {
      errors.push("Post createdAt must be a valid ISO datetime string");
    }

    // Content validation
    if (!record.text && !record.embed) {
      errors.push("Post must have either text content or an embed");
    }

    // Text length validation (Bluesky limit)
    if (record.text && record.text.length > 3000) {
      errors.push("Post text exceeds maximum length of 3000 characters");
    }

    // Facets validation
    if (record.facets !== undefined) {
      if (!Array.isArray(record.facets)) {
        errors.push("Post facets must be an array");
      } else {
        for (let i = 0; i < record.facets.length; i++) {
          const facetErrors = this.validateFacet(record.facets[i], i);
          errors.push(...facetErrors);
        }
      }
    }

    // Embed validation
    if (record.embed) {
      const embedErrors = this.validateEmbed(record.embed);
      errors.push(...embedErrors);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate a facet
   */
  private validateFacet(facet: any, index: number): string[] {
    const errors: string[] = [];

    if (!facet.index || typeof facet.index !== "object") {
      errors.push(`Facet ${index}: missing or invalid index`);
      return errors;
    }

    if (
      typeof facet.index.byteStart !== "number" ||
      typeof facet.index.byteEnd !== "number"
    ) {
      errors.push(
        `Facet ${index}: index must have numeric byteStart and byteEnd`,
      );
    }

    if (facet.index.byteStart < 0 || facet.index.byteEnd < 0) {
      errors.push(`Facet ${index}: index values must be non-negative`);
    }

    if (facet.index.byteStart >= facet.index.byteEnd) {
      errors.push(`Facet ${index}: byteStart must be less than byteEnd`);
    }

    if (!Array.isArray(facet.features)) {
      errors.push(`Facet ${index}: features must be an array`);
      return errors;
    }

    for (let i = 0; i < facet.features.length; i++) {
      const feature = facet.features[i];
      if (!feature.$type) {
        errors.push(`Facet ${index}, feature ${i}: missing $type`);
        continue;
      }

      switch (feature.$type) {
        case "app.bsky.richtext.facet#mention":
          if (!feature.did || typeof feature.did !== "string") {
            errors.push(
              `Facet ${index}, feature ${i}: mention must have a valid did`,
            );
          }
          break;
        case "app.bsky.richtext.facet#link":
          if (!feature.uri || typeof feature.uri !== "string") {
            errors.push(
              `Facet ${index}, feature ${i}: link must have a valid uri`,
            );
          }
          break;
        case "app.bsky.richtext.facet#tag":
          if (!feature.tag || typeof feature.tag !== "string") {
            errors.push(
              `Facet ${index}, feature ${i}: tag must have a valid tag`,
            );
          }
          break;
        default:
          errors.push(
            `Facet ${index}, feature ${i}: unknown feature type ${feature.$type}`,
          );
      }
    }

    return errors;
  }

  /**
   * Validate an embed
   */
  private validateEmbed(embed: any): string[] {
    const errors: string[] = [];

    if (!embed.$type) {
      errors.push("Embed: missing $type");
      return errors;
    }

    switch (embed.$type) {
      case "app.bsky.embed.images":
        if (!Array.isArray(embed.images)) {
          errors.push("Images embed: images must be an array");
        } else if (embed.images.length === 0) {
          errors.push("Images embed: must have at least one image");
        } else if (embed.images.length > 4) {
          errors.push("Images embed: cannot have more than 4 images");
        } else {
          for (let i = 0; i < embed.images.length; i++) {
            const image = embed.images[i];
            if (!image.image || !image.image.ref) {
              errors.push(
                `Images embed, image ${i}: missing image blob reference`,
              );
            }
            if (image.alt === undefined) {
              errors.push(`Images embed, image ${i}: missing alt text`);
            }
          }
        }
        break;
      case "app.bsky.embed.video":
        if (!embed.video || !embed.video.ref) {
          errors.push("Video embed: missing video blob reference");
        }
        break;
      case "app.bsky.embed.external":
        if (!embed.external) {
          errors.push("External embed: missing external object");
        }
        break;
      default:
        // Allow other embed types without validation for now
        break;
    }

    return errors;
  }

  /**
   * Validate a complete ATProto post
   */
  validateATProtoPost(post: ATProtoPost): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate basic structure
    if (!post.uri || typeof post.uri !== "string") {
      errors.push("Post must have a valid URI");
    }

    if (!post.cid || typeof post.cid !== "string") {
      errors.push("Post must have a valid CID");
    }

    if (!post.author || typeof post.author !== "object") {
      errors.push("Post must have a valid author object");
    } else {
      if (!post.author.did || typeof post.author.did !== "string") {
        errors.push("Post author must have a valid DID");
      }
      if (!post.author.handle || typeof post.author.handle !== "string") {
        errors.push("Post author must have a valid handle");
      }
    }

    if (!post.record || typeof post.record !== "object") {
      errors.push("Post must have a valid record object");
    } else {
      // Validate the record using lexicon
      const recordValidation = this.validatePost(post.record);
      errors.push(...recordValidation.errors);
    }

    if (!post.indexedAt || typeof post.indexedAt !== "string") {
      errors.push("Post must have a valid indexedAt timestamp");
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Check if a string is a valid ISO datetime
   */
  private isValidDateTime(dateTime: string): boolean {
    try {
      const date = new Date(dateTime);
      return !isNaN(date.getTime()) && dateTime.includes("T") &&
        dateTime.includes("Z");
    } catch {
      return false;
    }
  }

  /**
   * Sanitize an ATProto post by removing invalid fields
   */
  sanitizePost(post: any): any {
    const sanitized = { ...post };

    // Sanitize record
    if (sanitized.record) {
      // Ensure text is a string
      if (typeof sanitized.record.text !== "string") {
        sanitized.record.text = "";
      }

      // Remove invalid facets
      if (Array.isArray(sanitized.record.facets)) {
        sanitized.record.facets = sanitized.record.facets.filter(
          (facet: any) => {
            const validation = this.validateFacet(facet, 0);
            return validation.length === 0;
          },
        );
      }

      // Remove invalid embeds
      if (sanitized.record.embed) {
        const embedValidation = this.validateEmbed(sanitized.record.embed);
        if (embedValidation.length > 0) {
          delete sanitized.record.embed;
        }
      }
    }

    return sanitized;
  }
}
