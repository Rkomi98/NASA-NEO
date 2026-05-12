import type { FeedEvent } from "./types";

export function getOrbitClassType(item: FeedEvent): string {
  const orbitClass = item.orbital_data.orbit_class;
  if (orbitClass && typeof orbitClass === "object") {
    const value = orbitClass as {
      type?: unknown;
      orbit_class_type?: unknown;
    };
    return String(value.type ?? value.orbit_class_type ?? "NEO");
  }
  return "NEO";
}

export function getOrbitPaletteColor(index: number): string {
  const palette = [
    "#ff5c7a",
    "#52d6ff",
    "#ffd166",
    "#7cffb2",
    "#b98cff",
    "#ff9f45",
    "#67e8f9",
    "#f472b6",
    "#a3e635",
    "#f87171",
    "#38bdf8",
    "#facc15",
    "#c084fc",
    "#34d399",
    "#fb7185",
    "#60a5fa",
    "#fbbf24",
    "#2dd4bf",
  ];
  return palette[index % palette.length];
}
