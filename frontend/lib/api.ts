import { BACKEND_BASE_URL } from "./constants";
import type {
  ApiErrorShape,
  FeedResponse,
  HealthResponse,
  NeoDetailResponse,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = init?.body
    ? {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      }
    : init?.headers;

  const response = await fetch(`${BACKEND_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    let payload: ApiErrorShape | undefined;
    try {
      payload = (await response.json()) as ApiErrorShape;
    } catch {
      payload = undefined;
    }
    const message =
      payload?.error?.message ??
      `Richiesta fallita con status ${response.status}.`;
    const error = new Error(message);
    (error as Error & { status?: number; code?: string }).status = response.status;
    (error as Error & { status?: number; code?: string }).code =
      payload?.error?.code;
    throw error;
  }

  return (await response.json()) as T;
}

export function getFeed(
  startDate: string,
  endDate: string,
  signal?: AbortSignal,
): Promise<FeedResponse> {
  return request<FeedResponse>(
    `/api/feed?start_date=${startDate}&end_date=${endDate}`,
    { signal },
  );
}

export function getNeo(neoId: string, signal?: AbortSignal): Promise<NeoDetailResponse> {
  return request<NeoDetailResponse>(`/api/neo/${neoId}`, { signal });
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request<HealthResponse>("/api/health", { signal });
}
