// Shared session management for OAuth and auth routes
// Re-export database-backed session functions

export {
  createUserSession,
  deleteSession,
  generateSessionToken,
  getAllSessions,
  getSession,
  initSessionsTable,
} from "./session-db.ts";

// Legacy in-memory store for compatibility with debug endpoint
export const sessions = new Map<
  string,
  { userId: string; handle: string; expiresAt: number }
>();
