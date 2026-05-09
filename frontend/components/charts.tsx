"use client";

import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";

import type { FeedEvent } from "../lib/types";

type EChartsModule = typeof import("echarts");
type ChartOption = import("echarts").EChartsCoreOption;

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
      } catch {
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

export function DistanceOverTimeChart({ data }: { data: FeedEvent[] }) {
  const [ref, failed] = useChart(
    (echarts) => {
      const points = getSeriesData(data);
      return {
        backgroundColor: "transparent",
        tooltip: { trigger: "item" },
        grid: { left: 42, right: 12, top: 20, bottom: 34 },
        xAxis: { type: "time" },
        yAxis: { type: "value", name: "km" },
        series: [
          {
            type: "scatter",
            data: points.map((point) => [
              point.epoch,
              point.missKm,
              point.name,
              point.diameterMax,
            ]),
            itemStyle: {
              color: (params: { dataIndex: number }) =>
                points[params.dataIndex]?.hazardous ? "#ff5760" : "#6ec1ff",
            },
            symbolSize: (value: number[]) =>
              Math.max(8, Math.min(28, value[3] * 18)),
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
      const points = getSeriesData(data);
      if (!points.length) {
        return {};
      }
      const firstEpoch = points[0].epoch;
      return {
        tooltip: { trigger: "item" },
        xAxis3D: { type: "value", name: "giorni" },
        yAxis3D: { type: "value", name: "LD" },
        zAxis3D: { type: "value", name: "km/s" },
        grid3D: {
          boxWidth: 120,
          boxDepth: 80,
          environment: "#05060f",
          viewControl: {
            autoRotate: true,
            distance: 180,
          },
        },
        series: [
          {
            type: "scatter3D",
            data: points.map((point) => [
              (point.epoch - firstEpoch) / 86400000,
              point.missLunar,
              point.velocity,
              point.diameterMax,
            ]),
            symbolSize: (value: number[]) => Math.max(8, Math.min(24, value[3] * 18)),
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
