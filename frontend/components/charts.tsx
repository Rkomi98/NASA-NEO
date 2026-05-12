"use client";

import * as echarts from "echarts";
import type { ECharts, EChartsOption } from "echarts";
import { useEffect, useRef } from "react";
import type { FeedEvent } from "../lib/types";

function cssColors() {
  if (typeof document === "undefined") {
    return { ink: "#ededea", ink2: "#8a8a85", ink3: "#4a4a48", rule: "rgba(237,237,234,0.12)", signal: "#ff2d2d", paper: "#0a0a0a" };
  }
  const css = getComputedStyle(document.documentElement);
  return {
    ink: css.getPropertyValue("--ink").trim() || "#ededea",
    ink2: css.getPropertyValue("--ink-2").trim() || "#8a8a85",
    ink3: css.getPropertyValue("--ink-3").trim() || "#4a4a48",
    rule: css.getPropertyValue("--rule").trim() || "rgba(237,237,234,0.12)",
    signal: css.getPropertyValue("--signal").trim() || "#ff2d2d",
    paper: css.getPropertyValue("--paper").trim() || "#0a0a0a",
  };
}

function useEChart(buildOption: () => object, deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<ECharts | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    inst.current = echarts.init(el);

    const onResize = () => inst.current?.resize();
    const onTheme = () => inst.current?.setOption(buildOption() as EChartsOption, true);

    window.addEventListener("resize", onResize);
    window.addEventListener("arkemis-theme", onTheme);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("arkemis-theme", onTheme);
      inst.current?.dispose();
      inst.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    inst.current?.setOption(buildOption() as EChartsOption, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}

// ─────────────────────────────────────────────────────────────
// Distance over time scatter chart
// ─────────────────────────────────────────────────────────────
interface DistanceOverTimeChartProps {
  data: FeedEvent[];
  currentT: number;
}

export function DistanceOverTimeChart({ data, currentT }: DistanceOverTimeChartProps) {
  const buildOption = () => {
    const c = cssColors();

    const safe = data
      .filter((a) => !a.is_potentially_hazardous_asteroid)
      .map((a) => [
        a.close_approach.epoch_date_close_approach,
        parseFloat(a.close_approach.miss_distance.lunar ?? "0"),
        a.estimated_diameter.kilometers.estimated_diameter_max,
        a.name,
      ]);

    const haz = data
      .filter((a) => a.is_potentially_hazardous_asteroid)
      .map((a) => [
        a.close_approach.epoch_date_close_approach,
        parseFloat(a.close_approach.miss_distance.lunar ?? "0"),
        a.estimated_diameter.kilometers.estimated_diameter_max,
        a.name,
      ]);

    return {
      backgroundColor: "transparent",
      grid: { left: 52, right: 12, top: 8, bottom: 30 },
      tooltip: {
        backgroundColor: c.ink,
        borderColor: c.ink,
        textStyle: { color: c.paper, fontFamily: "JetBrains Mono", fontSize: 11 },
        formatter: (p: { value: [number, number, number, string] }) =>
          `${p.value[3]}<br/>${new Date(p.value[0]).toISOString().slice(0, 10)} · ${p.value[1].toFixed(2)} LD`,
      },
      xAxis: {
        type: "time",
        axisLine: { lineStyle: { color: c.ink3 } },
        axisLabel: { color: c.ink2, fontSize: 10, fontFamily: "JetBrains Mono" },
        splitLine: { show: false },
      },
      yAxis: {
        type: "log",
        logBase: 10,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: c.ink2, fontSize: 10, fontFamily: "JetBrains Mono", formatter: (v: number) => v + " LD" },
        splitLine: { lineStyle: { color: c.rule } },
      },
      series: [
        {
          name: "safe",
          type: "scatter",
          data: safe,
          symbolSize: (v: number[]) => Math.max(4, Math.min(18, Math.log10(v[2] + 0.01) * 5 + 8)),
          itemStyle: { color: c.ink2, opacity: 0.7 },
        },
        {
          name: "haz",
          type: "scatter",
          data: haz,
          symbolSize: (v: number[]) => Math.max(6, Math.min(22, Math.log10(v[2] + 0.01) * 5 + 10)),
          itemStyle: { color: c.signal, opacity: 0.95 },
        },
        {
          type: "line",
          silent: true,
          markLine: {
            symbol: "none",
            silent: true,
            lineStyle: { color: c.signal, opacity: 0.55, width: 1 },
            label: { color: c.signal, fontFamily: "JetBrains Mono", fontSize: 9, formatter: "NOW", position: "insideEndTop" },
            data: [{ xAxis: currentT }],
          },
        },
        {
          type: "line",
          silent: true,
          markLine: {
            symbol: "none",
            silent: true,
            lineStyle: { color: c.ink3, type: "dashed" },
            label: { color: c.ink3, fontFamily: "JetBrains Mono", fontSize: 9, formatter: "moon · 1 LD", position: "insideEndTop" },
            data: [{ yAxis: 1 }],
          },
        },
      ],
    };
  };

  const ref = useEChart(buildOption, [data, currentT]);
  return <div ref={ref} className="echart" />;
}

// ─────────────────────────────────────────────────────────────
// Size distribution histogram
// ─────────────────────────────────────────────────────────────
interface SizeHistogramProps {
  data: FeedEvent[];
}

export function SizeHistogram({ data }: SizeHistogramProps) {
  const buildOption = () => {
    const c = cssColors();

    const bins = [
      { min: 0, max: 0.05, label: "<50 m" },
      { min: 0.05, max: 0.14, label: "50–140" },
      { min: 0.14, max: 0.5, label: "140–500" },
      { min: 0.5, max: 1, label: "500m–1k" },
      { min: 1, max: 100, label: ">1 km" },
    ];
    const safe = bins.map(() => 0);
    const haz = bins.map(() => 0);
    data.forEach((a) => {
      const d = a.estimated_diameter.kilometers.estimated_diameter_max;
      const i = bins.findIndex((b) => d >= b.min && d < b.max);
      if (i < 0) return;
      if (a.is_potentially_hazardous_asteroid) haz[i]++;
      else safe[i]++;
    });

    return {
      backgroundColor: "transparent",
      grid: { left: 24, right: 8, top: 14, bottom: 32 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: c.ink,
        borderColor: c.ink,
        textStyle: { color: c.paper, fontFamily: "JetBrains Mono", fontSize: 11 },
      },
      xAxis: {
        type: "category",
        data: bins.map((b) => b.label),
        axisLine: { lineStyle: { color: c.ink3 } },
        axisTick: { show: false },
        axisLabel: { color: c.ink2, fontSize: 10, fontFamily: "JetBrains Mono", interval: 0 },
      },
      yAxis: {
        type: "value",
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: c.ink2, fontSize: 10, fontFamily: "JetBrains Mono" },
        splitLine: { lineStyle: { color: c.rule } },
      },
      series: [
        { name: "safe", type: "bar", stack: "x", data: safe, itemStyle: { color: c.ink2 }, barWidth: "44%" },
        { name: "haz", type: "bar", stack: "x", data: haz, itemStyle: { color: c.signal }, barWidth: "44%" },
      ],
    };
  };

  const ref = useEChart(buildOption, [data]);
  return <div ref={ref} className="echart" />;
}
