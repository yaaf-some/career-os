/**
 * The one way to call the API. Feature folders put their own calls in a local
 * `api.ts` built on `request`, so features never edit a shared client.
 */

/** Error from the API's `{error, code}` body. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  const text = await res.text();
  try {
    const body = JSON.parse(text) as { error?: unknown; code?: unknown };
    if (typeof body.error === 'string') {
      return new ApiError(body.error, res.status, typeof body.code === 'string' ? body.code : null);
    }
  } catch {
    // not JSON
  }
  return new ApiError(text || `API request failed (${res.status})`, res.status, null);
}

/** JSON request to the API. Failures, including network ones, throw `ApiError`. */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(
      'Cannot reach Career OS. Check your connection and Tailscale.',
      0,
      'NETWORK_ERROR',
    );
  }
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}
