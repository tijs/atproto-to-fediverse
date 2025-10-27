// Lightweight helper to mock global fetch within a test scope

export type FetchLike = (
  input: Request | URL | string,
  init?: RequestInit,
) => Response | Promise<Response>;

export function jsonResponse(
  body: unknown,
  init: ResponseInit = { status: 200 },
): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

export function textResponse(
  body: string,
  init: ResponseInit = { status: 200 },
): Response {
  return new Response(body, init);
}

// Runs a function with fetch temporarily replaced. Restores after completion.
export async function withMockFetch(
  impl: FetchLike,
  fn: () => Promise<void> | void,
) {
  const originalFetch = globalThis.fetch;
  // @ts-ignore allow override in tests
  globalThis.fetch = impl as any;
  try {
    await fn();
  } finally {
    // @ts-ignore restore
    globalThis.fetch = originalFetch as any;
  }
}
