export type HazardFilter = "all" | "hazardous" | "safe";
export type SortKey =
  | "approach_date"
  | "miss_distance_km"
  | "diameter_max_km"
  | "relative_velocity_kps";

export interface ApiErrorShape {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
}

export interface RateLimitState {
  limit: number | null;
  remaining: number | null;
  request_id: string | null;
}

export interface FeedEvent {
  event_id: string;
  id: string;
  neo_reference_id: string;
  name: string;
  designation?: string | null;
  nasa_jpl_url: string;
  absolute_magnitude_h?: number | null;
  is_potentially_hazardous_asteroid: boolean;
  is_sentry_object: boolean;
  estimated_diameter: {
    kilometers: {
      estimated_diameter_min: number;
      estimated_diameter_max: number;
    };
    [key: string]: unknown;
  };
  orbital_data: Record<string, unknown>;
  close_approach: {
    close_approach_date: string;
    close_approach_date_full?: string;
    epoch_date_close_approach: number;
    relative_velocity: {
      kilometers_per_second: string;
      kilometers_per_hour?: string;
      miles_per_hour?: string;
    };
    miss_distance: {
      kilometers: string;
      lunar?: string;
      astronomical?: string;
    };
    orbiting_body: string;
  };
}

export interface FeedResponse {
  meta: {
    start_date: string;
    end_date: string;
    requested_days: number;
    chunk_count: number;
    generated_at: string;
    cache: { hits: number; misses: number };
    last_upstream_rate_limit: RateLimitState;
  };
  stats: {
    total: number;
    hazardous: number;
    non_hazardous: number;
    closest_miss_km: number | null;
    largest_diameter_km: number | null;
    fastest_kps: number | null;
  };
  near_earth_objects: FeedEvent[];
}

export interface NeoDetailResponse {
  id: string;
  neo_reference_id: string;
  name: string;
  designation?: string | null;
  nasa_jpl_url: string;
  absolute_magnitude_h?: number | null;
  is_potentially_hazardous_asteroid: boolean;
  is_sentry_object: boolean;
  estimated_diameter: {
    kilometers: {
      estimated_diameter_min: number;
      estimated_diameter_max: number;
    };
    [key: string]: unknown;
  };
  orbital_data: Record<string, unknown>;
  close_approach_data: Array<{
    close_approach_date: string;
    close_approach_date_full?: string;
    epoch_date_close_approach?: number;
    relative_velocity?: Record<string, string>;
    miss_distance?: Record<string, string>;
    orbiting_body?: string;
  }>;
}

export interface HealthResponse {
  status: "ok";
  cache: {
    entries: number;
    size_bytes: number;
    hit_ratio: number;
    expired_entries: number;
  };
  upstream: {
    last_status: number | null;
    last_rate_limit_limit: number | null;
    last_rate_limit_remaining: number | null;
    last_request_at: string | null;
  };
}
