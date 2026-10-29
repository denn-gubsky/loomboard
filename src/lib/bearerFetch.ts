import type { TokenProvider } from "@loomcycle/client";

// A fetch that carries a signed-in user's access token to ONE loomcycle.
//
// Why a fetch and not ClientOptions.tokenProvider: the surfaces loomboard
// embeds (@loomcycle/library, explorer, memory-view, loomboard views, the
// workflow canvas, <Chat>) each build their own client — or call fetch
// themselves — from a {baseUrl, token, fetch} Connection, and a static token
// goes stale within the hour. Handing them a fetch that asks the provider for
// the current token keeps every one of them signed in without changing their
// APIs. Clients the app builds itself use tokenProvider directly.
//
// The token goes only to the connected loomcycle's /v1 surface: a request
// anywhere else (another origin, or a non-API path on the dev server) passes
// through untouched, so a component fetching a third-party URL through this
// connection can never leak the bearer.

/** The origin + path prefix a bearer may be sent to: `<origin><path>/v1/`.
 *  An empty baseUrl (the dev/CLI proxy) is this page's own origin. */
export function apiPrefix(baseUrl: string, pageHref?: string): string | null {
  try {
    const u = baseUrl ? new URL(baseUrl) : new URL("/", pageHref);
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}/v1/`;
  } catch {
    return null;
  }
}

function requestUrl(input: RequestInfo | URL, pageHref?: string): string | null {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(raw, pageHref).href;
  } catch {
    return null;
  }
}

function withBearer(input: RequestInfo | URL, init: RequestInit | undefined, token: string | undefined): RequestInit {
  const base = init?.headers ?? (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined);
  const headers = new Headers(base);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  else headers.delete("Authorization");
  return { ...init, headers };
}

/** Wrap `inner` so requests under `prefix` (see apiPrefix) carry the
 *  provider's current access token, retried once with a fresh one after a 401
 *  (unless the body is a stream, which cannot be sent twice). */
export function bearerFetch(
  inner: typeof fetch,
  provider: TokenProvider,
  prefix: string,
  pageHref?: string,
): typeof fetch {
  return async (input, init) => {
    const url = requestUrl(input, pageHref);
    if (!url || !url.startsWith(prefix)) return inner(input, init);
    // A Request's own body is consumed by the first send, so keep a copy for
    // the retry (only when it has one and init does not replace it).
    const spare =
      typeof Request !== "undefined" && input instanceof Request && input.body !== null && init?.body === undefined
        ? input.clone()
        : input;
    const token = await provider.getToken();
    const first = await inner(input, withBearer(input, init, token));
    if (first.status !== 401 || !provider.onUnauthorized) return first;
    if (typeof ReadableStream !== "undefined" && init?.body instanceof ReadableStream) return first;
    const fresh = await provider.onUnauthorized(token);
    if (!fresh || fresh === token) return first;
    await first.body?.cancel().catch(() => undefined);
    return inner(spare, withBearer(spare, init, fresh));
  };
}
