// Database-backed session storage for Val.town
import { sqlite } from "https://esm.town/v/stevekrouse/sqlite";

export function generateSessionToken(): string {
  return crypto.randomUUID();
}

// Initialize sessions table
export async function initSessionsTable() {
  await sqlite.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      handle TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);
}

// Clean up expired sessions
export async function cleanupSessions() {
  const now = Date.now();
  await sqlite.execute(
    "DELETE FROM sessions WHERE expires_at < ?",
    [now],
  );
}

// Create session after successful OAuth or login
export async function createUserSession(
  userId: string,
  handle: string,
): Promise<{ sessionToken: string; expiresAt: number }> {
  const sessionToken = generateSessionToken();
  const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days

  await sqlite.execute(
    "INSERT INTO sessions (token, user_id, handle, expires_at) VALUES (?, ?, ?, ?)",
    [sessionToken, userId, handle, expiresAt],
  );

  // Clean up old sessions
  await cleanupSessions();

  console.log("Session created in DB:", {
    sessionToken: sessionToken.substring(0, 8) + "...",
    userId,
    handle,
    expiresAt: new Date(expiresAt).toISOString(),
  });

  return { sessionToken, expiresAt };
}

// Get session by token
export async function getSession(
  token: string,
): Promise<{ userId: string; handle: string; expiresAt: number } | null> {
  const result = await sqlite.execute(
    "SELECT user_id, handle, expires_at FROM sessions WHERE token = ?",
    [token],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const session = result.rows[0] as unknown as {
    user_id: string;
    handle: string;
    expires_at: number;
  };

  if (session.expires_at < Date.now()) {
    // Clean up expired session
    await sqlite.execute("DELETE FROM sessions WHERE token = ?", [token]);
    return null;
  }

  return {
    userId: session.user_id,
    handle: session.handle,
    expiresAt: session.expires_at,
  };
}

// Delete session
export async function deleteSession(token: string): Promise<void> {
  await sqlite.execute("DELETE FROM sessions WHERE token = ?", [token]);
}

// Get all sessions for debugging
export async function getAllSessions() {
  const result = await sqlite.execute(
    "SELECT token, user_id, handle, expires_at FROM sessions",
  );

  return result.rows.map((row) => ({
    token: (row as any).token.substring(0, 8) + "...",
    userId: (row as any).user_id,
    handle: (row as any).handle,
    expiresAt: (row as any).expires_at,
    expired: (row as any).expires_at < Date.now(),
  }));
}
