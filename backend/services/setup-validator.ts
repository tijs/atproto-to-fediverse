import { StorageProvider } from "../interfaces/storage.ts";

export interface SetupValidationResult {
  account: any;
  shouldProceed: boolean;
}

export class SetupValidator {
  constructor(private storage: StorageProvider) {}

  /**
   * Check if setup is complete and sync should proceed
   */
  async validateSetup(): Promise<SetupValidationResult> {
    // Get user account
    const account = await this.storage.userAccounts.getSingle();
    if (!account) {
      throw new Error("User account not found");
    }

    // Check if user has completed setup
    if (!account.setup_completed) {
      console.log("User setup not completed - skipping sync");
      return { account, shouldProceed: false };
    }

    // Check if user has required tokens
    if (!account.atproto_access_token || !account.mastodon_access_token) {
      console.log("User account not fully configured - skipping sync");
      return { account, shouldProceed: false };
    }

    return { account, shouldProceed: true };
  }
}
