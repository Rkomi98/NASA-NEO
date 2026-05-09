"use client";

import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";

import type { FeedEvent } from "../lib/types";

type EChartsModule = typeof import("echarts");
type ChartOption = import("echarts").EChartsCoreOption;
type OrbitPoint = [number, number, number];

const PLANETS = [
  { name: "Mercurio", semiMajorAxis: 0.387, eccentricity: 0.206, color: "#c6b09a", size: 5 },
  { name: "Venere", semiMajorAxis: 0.723, eccentricity: 0.007, color: "#e7c172", size: 7 },
  { name: "Terra", semiMajorAxis: 1, eccentricity: 0.017, color: "#5fb5ff", size: 9 },
  { name: "Marte", semiMajorAxis: 1.524, eccentricity: 0.093, color: "#ff765e", size: 7 },
];

function useChart(
  buildOption: (echarts: EChartsModule) => ChartOption,
  deps: unknown[],
): [RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let instance: import("echarts").ECharts | undefined;
    let mounted = true;
    async function mount() {
      try {
        const echarts = await import("echarts");
        await import("echarts-gl");
        if (!ref.current || !mounted) {
          return;
        }
        instance = echarts.init(ref.current);
        instance.setOption(buildOption(echarts));
        const resize = () => instance?.resize();
        window.addEventListener("resize", resize);
        return () => window.removeEventListener("resize", resize);
      } catch (error) {
        console.error("Chart render failed", error);
        if (mounted) {
          setFailed(true);
        }
      }
    }

    const cleanupPromise = mount();
    return () => {
      mounted = false;
      void cleanupPromise;
      instance?.dispose();
    };
  }, deps);

  return [ref, failed];
}

function getSeriesData(data: FeedEvent[]) {
  return data.map((item) => ({
    date: item.close_approach.close_approach_date,
    epoch: item.close_approach.epoch_date_close_approach,
    missKm: Number(item.close_approach.miss_distance.kilometers),
    missLunar: Number(item.close_approach.miss_distance.lunar ?? 0),
    velocity: Number(item.close_approach.relative_velocity.kilometers_per_second),
    diameterMax:
      item.estimated_diameter.kilometers.estimated_diameter_max,
    hazardous: item.is_potentially_hazardous_asteroid,
    name: item.name,
  }));
}

function formatCompactKm(value: number): string {
  if (!Number.isFinite(value)) {
    return "--";
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M km`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(0)}K km`;
  }
  return `${value.toFixed(0)} km`;
}

function formatChartDate(value: number | string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

function parseOrbitNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getOrbitClassType(item: FeedEvent): string {
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

function getOrbitPaletteColor(index: number): string {
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

function buildOrbitPath({
  semiMajorAxis,
  eccentricity,
  inclinationDeg = 0,
  phase = 0,
  samples = 144,
  closed = true,
  arc = Math.PI * 2,
}: {
  semiMajorAxis: number;
  eccentricity: number;
  inclinationDeg?: number;
  phase?: number;
  samples?: number;
  closed?: boolean;
  arc?: number;
}): OrbitPoint[] {
  const clampedEccentricity = Math.max(0, Math.min(0.92, eccentricity));
  const inclination = (inclinationDeg * Math.PI) / 180;
  const points: OrbitPoint[] = [];

  const steps = closed ? samples : Math.max(2, samples);
  const startAngle = phase - arc / 2;

  for (let index = 0; index <= steps; index += 1) {
    const angle = startAngle + (index / steps) * arc;
    const radius =
      (semiMajorAxis * (1 - clampedEccentricity * clampedEccentricity)) /
      (1 + clampedEccentricity * Math.cos(angle));
    const x = radius * Math.cos(angle);
    const yFlat = radius * Math.sin(angle);
    points.push([
      Number(x.toFixed(4)),
      Number((yFlat * Math.cos(inclination)).toFixed(4)),
      Number((yFlat * Math.sin(inclination)).toFixed(4)),
    ]);
  }

  return points;
}

function estimateAsteroidPosition(item: FeedEvent, index: number): OrbitPoint {
  const semiMajorAxis = parseOrbitNumber(item.orbital_data.semi_major_axis) ?? 1.4;
  const eccentricity = parseOrbitNumber(item.orbital_data.eccentricity) ?? 0.2;
  const inclination = parseOrbitNumber(item.orbital_data.inclination) ?? 0;
  const orbitalPeriod = parseOrbitNumber(item.orbital_data.orbital_period) ?? 365;
  const approachEpoch = item.close_approach.epoch_date_close_approach;
  const daysSinceEpoch = (approachEpoch - Date.UTC(2000, 0, 1)) / 86400000;
  const phase = ((daysSinceEpoch / orbitalPeriod) * Math.PI * 2 + index * 0.37) % (Math.PI * 2);
  const path = buildOrbitPath({
    semiMajorAxis,
    eccentricity,
    inclinationDeg: inclination,
    phase,
    samples: 1,
  });
  return path[0];
}

function buildAsteroidOrbit(item: FeedEvent, index: number) {
  const hasRealElements =
    parseOrbitNumber(item.orbital_data.semi_major_axis) != null &&
    parseOrbitNumber(item.orbital_data.eccentricity) != null;
  const semiMajorAxis =
    parseOrbitNumber(item.orbital_data.semi_major_axis) ??
    parseOrbitNumber(item.orbital_data.aphelion_distance) ??
    Math.min(3.8, Math.max(0.72, Number(item.close_approach.miss_distance.astronomical ?? 1) + 1)) ??
    1.6;
  const eccentricity =
    parseOrbitNumber(item.orbital_data.eccentricity) ??
    Math.min(0.72, 0.12 + Number(item.close_approach.miss_distance.lunar ?? 8) / 120);
  const inclination =
    parseOrbitNumber(item.orbital_data.inclination) ??
    Math.min(32, Number(item.close_approach.relative_velocity.kilometers_per_second) * 1.2);
  const orbitalPeriod = parseOrbitNumber(item.orbital_data.orbital_period);
  const moid = parseOrbitNumber(item.orbital_data.minimum_orbit_intersection);
  const observations = parseOrbitNumber(item.orbital_data.observations_used);
  const orbitClass = getOrbitClassType(item);
  const phase = (index * Math.PI) / 11;
  const samples = hasRealElements ? 144 : 24;

  return {
    rank: index + 1,
    name: item.name,
    orbitClass,
    color: getOrbitPaletteColor(index),
    semiMajorAxis,
    eccentricity,
    inclination,
    orbitalPeriod,
    moid,
    observations,
    hasRealElements,
    position: estimateAsteroidPosition(item, index),
    diameter:
      item.estimated_diameter.kilometers.estimated_diameter_max,
    hazardous: item.is_potentially_hazardous_asteroid,
    path: buildOrbitPath({
      semiMajorAxis,
      eccentricity,
      inclinationDeg: inclination,
      phase,
      samples,
      closed: hasRealElements,
      arc: hasRealElements ? Math.PI * 2 : Math.PI * 0.46,
    }),
  };
}

export function DistanceOverTimeChart({ data }: { data: FeedEvent[] }) {
  const [ref, failed] = useChart(
    (echarts) => {
      const points = getSeriesData(data);
      return {
        backgroundColor: "transparent",
        tooltip: {
          trigger: "item",
          confine: true,
          backgroundColor: "rgba(255, 255, 255, 0.96)",
          borderColor: "rgba(255, 87, 96, 0.7)",
          borderWidth: 1,
          textStyle: { color: "#0b1b3c", fontSize: 12 },
          formatter: (params: { data?: unknown[] }) => {
            const value = params.data;
            if (!Array.isArray(value)) {
              return "";
            }
            const missKm = Number(value[2]);
            const missLunar = Number(value[3]);
            const velocity = Number(value[4]);
            const diameter = Number(value[5]);
            return [
              `<strong>${value[6] ?? "Asteroide"}</strong>`,
              `Data: ${formatChartDate(Number(value[0]))}`,
              `Distanza: ${formatCompactKm(missKm)}`,
              `Lunar distance: ${Number.isFinite(missLunar) ? missLunar.toFixed(2) : "--"} LD`,
              `Velocita': ${Number.isFinite(velocity) ? velocity.toFixed(2) : "--"} km/s`,
              `Diametro max: ${Number.isFinite(diameter) ? diameter.toFixed(2) : "--"} km`,
              `Rischio: ${value[7] ? "potenziale" : "basso"}`,
            ].join("<br/>");
          },
        },
        grid: { left: 96, right: 24, top: 36, bottom: 58, containLabel: true },
        xAxis: {
          type: "time",
          name: "Data close approach",
          nameLocation: "middle",
          nameGap: 34,
          nameTextStyle: {
            color: "rgba(175, 175, 199, 0.78)",
            fontWeight: 600,
          },
          axisLabel: {
            color: "rgba(175, 175, 199, 0.86)",
            formatter: (value: number) => formatChartDate(value),
          },
          axisLine: { lineStyle: { color: "rgba(175, 175, 199, 0.52)" } },
          axisTick: { lineStyle: { color: "rgba(175, 175, 199, 0.38)" } },
          splitLine: { show: false },
        },
        yAxis: {
          type: "value",
          name: "Distanza Terra (milioni km)",
          nameLocation: "middle",
          nameRotate: 90,
          nameGap: 62,
          nameTextStyle: {
            color: "rgba(175, 175, 199, 0.78)",
            fontWeight: 600,
          },
          axisLabel: {
            color: "rgba(175, 175, 199, 0.86)",
            formatter: (value: number) => `${value.toFixed(0)}M`,
          },
          axisLine: { show: true, lineStyle: { color: "rgba(175, 175, 199, 0.52)" } },
          axisTick: { show: true, lineStyle: { color: "rgba(175, 175, 199, 0.38)" } },
          splitLine: { lineStyle: { color: "rgba(175, 175, 199, 0.18)" } },
        },
        series: [
          {
            name: "Distanza",
            type: "scatter",
            data: points.map((point) => [
              point.epoch,
              point.missKm / 1_000_000,
              point.missKm,
              point.missLunar,
              point.velocity,
              point.diameterMax,
              point.name,
              point.hazardous,
            ]),
            itemStyle: {
              color: (params: { dataIndex: number }) =>
                points[params.dataIndex]?.hazardous ? "#ff5760" : "#6ec1ff",
              borderColor: "#05060f",
              borderWidth: 1,
            },
            symbolSize: (value: number[]) =>
              Math.max(8, Math.min(28, value[5] * 18)),
            emphasis: {
              scale: 1.35,
              itemStyle: {
                shadowBlur: 18,
                shadowColor: "rgba(255, 255, 255, 0.24)",
              },
            },
          },
        ],
      };
    },
    [data],
  );

  if (failed) {
    return <div className="chart-fallback">Grafico distanza non disponibile.</div>;
  }

  return <div ref={ref} className="chart-surface" />;
}

export function SizeDistributionChart({ data }: { data: FeedEvent[] }) {
  const [ref, failed] = useChart(
    () => {
      const buckets = [
        { label: "< 50 m", min: 0, max: 0.05 },
        { label: "50-140 m", min: 0.05, max: 0.14 },
        { label: "140-500 m", min: 0.14, max: 0.5 },
        { label: "500 m - 1 km", min: 0.5, max: 1 },
        { label: "> 1 km", min: 1, max: Infinity },
      ];
      const safe = buckets.map(() => 0);
      const hazard = buckets.map(() => 0);

      data.forEach((item) => {
        const value = item.estimated_diameter.kilometers.estimated_diameter_max;
        const bucketIndex = buckets.findIndex(
          (bucket) => value >= bucket.min && value < bucket.max,
        );
        if (bucketIndex === -1) {
          return;
        }
        if (item.is_potentially_hazardous_asteroid) {
          hazard[bucketIndex] += 1;
        } else {
          safe[bucketIndex] += 1;
        }
      });

      return {
        backgroundColor: "transparent",
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
        legend: { bottom: 0 },
        grid: { left: 32, right: 8, top: 24, bottom: 44 },
        xAxis: { type: "category", data: buckets.map((bucket) => bucket.label) },
        yAxis: { type: "value" },
        series: [
          {
            name: "Sicuri",
            type: "bar",
            stack: "items",
            data: safe,
            itemStyle: { color: "#6ec1ff" },
          },
          {
            name: "Pericolosi",
            type: "bar",
            stack: "items",
            data: hazard,
            itemStyle: { color: "#ff5760" },
          },
        ],
      };
    },
    [data],
  );

  if (failed) {
    return <div className="chart-fallback">Grafico dimensioni non disponibile.</div>;
  }

  return <div ref={ref} className="chart-surface" />;
}

export function Orbital3DChart({ data }: { data: FeedEvent[] }) {
  const [ref, failed] = useChart(
    () => {
      const items = [...data]
        .sort((a, b) => {
          const hazardDelta =
            Number(b.is_potentially_hazardous_asteroid) -
            Number(a.is_potentially_hazardous_asteroid);
          if (hazardDelta !== 0) {
            return hazardDelta;
          }
          return (
            Number(a.close_approach.miss_distance.kilometers) -
            Number(b.close_approach.miss_distance.kilometers)
          );
        })
        .slice(0, 18);
      const asteroidOrbits = items.map(buildAsteroidOrbit);
      if (!asteroidOrbits.length) {
        return {};
      }
      const planetOrbits = PLANETS.map((planet) => ({
        ...planet,
        path: buildOrbitPath({
          semiMajorAxis: planet.semiMajorAxis,
          eccentricity: planet.eccentricity,
          samples: 180,
        }),
      }));

      return {
        backgroundColor: "#03050d",
        tooltip: {
          trigger: "item",
          confine: true,
          backgroundColor: "rgba(255,255,255,0.96)",
          borderColor: "rgba(110,193,255,0.55)",
          textStyle: { color: "#0b1b3c", fontSize: 12 },
          formatter: (params: { seriesName?: string; data?: { value?: unknown[] } | unknown[] }) => {
            const dataValue = Array.isArray(params.data) ? params.data : params.data?.value;
            const value = dataValue;
            if (!Array.isArray(value)) {
              return `<strong>${params.seriesName ?? ""}</strong>`;
            }
            return [
              `<strong>${value[3] ?? params.seriesName}</strong>`,
              `Classe: ${value[4] ?? "--"}`,
              `a: ${value[5] ?? "--"} AU`,
              `e: ${value[6] ?? "--"}`,
              `i: ${value[7] ?? "--"} deg`,
              `MOID: ${value[8] ?? "--"} AU`,
            ].join("<br/>");
          },
        },
        xAxis3D: {
          type: "value",
          name: "X AU",
          min: -4,
          max: 4,
          axisLine: { lineStyle: { color: "rgba(255,255,255,0.28)" } },
          axisLabel: { color: "rgba(255,255,255,0.44)" },
          splitLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
        },
        yAxis3D: {
          type: "value",
          name: "Y AU",
          min: -4,
          max: 4,
          axisLine: { lineStyle: { color: "rgba(255,255,255,0.28)" } },
          axisLabel: { color: "rgba(255,255,255,0.44)" },
          splitLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
        },
        zAxis3D: {
          type: "value",
          name: "Incl.",
          min: -1.6,
          max: 1.6,
          axisLine: { lineStyle: { color: "rgba(255,255,255,0.22)" } },
          axisLabel: { color: "rgba(255,255,255,0.38)" },
          splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
        },
        grid3D: {
          boxWidth: 180,
          boxDepth: 180,
          boxHeight: 70,
          environment: "#03050d",
          axisPointer: { show: false },
          light: {
            main: { intensity: 1.5, shadow: true },
            ambient: { intensity: 0.25 },
          },
          postEffect: {
            enable: true,
            bloom: { enable: true, bloomIntensity: 0.24 },
          },
          viewControl: {
            autoRotate: true,
            autoRotateSpeed: 2.6,
            distance: 235,
            alpha: 38,
            beta: 32,
            damping: 0.78,
          },
        },
        series: [
          ...planetOrbits.map((orbit) => ({
            name: `${orbit.name} orbit`,
            type: "line3D",
            coordinateSystem: "cartesian3D",
            data: orbit.path,
            lineStyle: {
              width: orbit.name === "Terra" ? 2.4 : 1.4,
              color: orbit.color,
              opacity: orbit.name === "Terra" ? 0.8 : 0.38,
            },
          })),
          {
            name: "Pianeti",
            type: "scatter3D",
            coordinateSystem: "cartesian3D",
            data: PLANETS.map((planet, index) => {
              const path = planetOrbits[index].path;
              const point = path[Math.floor(path.length * 0.12)];
              return {
                value: [...point, planet.name, "Planet", planet.semiMajorAxis, planet.eccentricity, 0, "--"],
                itemStyle: { color: planet.color },
              };
            }),
            symbolSize: (value: unknown[]) =>
              PLANETS.find((planet) => planet.name === value[3])?.size ?? 7,
          },
          {
            name: "Sole",
            type: "scatter3D",
            coordinateSystem: "cartesian3D",
            data: [{ value: [0, 0, 0, "Sole", "Star", "--", "--", "--", "--"] }],
            symbolSize: 18,
            itemStyle: { color: "#ffd166", opacity: 1 },
          },
          ...asteroidOrbits.map((orbit) => ({
            name: orbit.name,
            type: "line3D",
            coordinateSystem: "cartesian3D",
            data: orbit.path,
            lineStyle: {
              color: orbit.color,
              opacity: orbit.hasRealElements
                ? orbit.hazardous ? 0.48 : 0.26
                : orbit.hazardous ? 0.72 : 0.42,
              width: orbit.hasRealElements
                ? orbit.hazardous ? 1.8 : 1
                : orbit.hazardous ? 2.6 : 1.8,
              type: orbit.hasRealElements ? "solid" : "dashed",
            },
            silent: true,
          })),
          {
            name: "Asteroidi",
            type: "scatter3D",
            coordinateSystem: "cartesian3D",
            data: asteroidOrbits.map((orbit) => ({
              value: [
                ...orbit.position,
                orbit.name,
                orbit.orbitClass,
                orbit.semiMajorAxis.toFixed(2),
                orbit.eccentricity.toFixed(2),
                orbit.inclination.toFixed(1),
                orbit.moid?.toFixed(3) ?? "--",
                orbit.observations ?? "--",
                orbit.orbitalPeriod?.toFixed(0) ?? "--",
              ],
              itemStyle: {
                color: orbit.color,
                opacity: orbit.hazardous ? 1 : 0.78,
              },
              label: {
                show: orbit.rank <= 7,
                formatter: `#${orbit.rank} ${orbit.name.replace(/[()]/g, "")}`,
                distance: 8,
                textStyle: {
                  color: "#f1eee5",
                  fontSize: 10,
                  backgroundColor: "rgba(5,6,15,0.72)",
                  borderColor: orbit.color,
                  borderWidth: 1,
                  borderRadius: 4,
                  padding: [3, 5],
                },
              },
            })),
            symbolSize: (value: unknown[]) => {
              const diameter = asteroidOrbits.find((orbit) => orbit.name === value[3])?.diameter ?? 0.12;
              return Math.max(5, Math.min(18, diameter * 14));
            },
          },
        ],
      };
    },
    [data],
  );

  if (failed) {
    return <div className="chart-fallback">Vista 3D non disponibile.</div>;
  }

  return <div ref={ref} className="hero-chart" />;
}
