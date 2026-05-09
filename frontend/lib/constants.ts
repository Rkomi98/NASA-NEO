export const DEFAULT_DAYS = 30;
export const BACKEND_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

export const SORT_OPTIONS = [
  { value: "approach_date", label: "Data avvicinamento" },
  { value: "miss_distance_km", label: "Distanza minima" },
  { value: "diameter_max_km", label: "Dimensione massima" },
  { value: "relative_velocity_kps", label: "Velocita' relativa" },
] as const;

export const HAZARD_FILTERS = [
  { value: "all", label: "Tutti" },
  { value: "hazardous", label: "Pericolosi" },
  { value: "safe", label: "Sicuri" },
] as const;
