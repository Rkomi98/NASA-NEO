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
  const buildOptionRef = useRef(buildOption);
  buildOptionRef.current = buildOption;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    inst.current = echarts.init(el);

    const onResize = () => inst.current?.resize();
    const onTheme = () => inst.current?.setOption(buildOptionRef.current() as EChartsOption, true);

    window.addEventListener("resize", onResize);
    window.addEventListener("arkemis-theme", onTheme);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("arkemis-theme", onTheme);
      inst.current?.dispose();
      inst.current = null;
    };
  }, []);

  useEffect(() => {
    inst.current?.setOption(buildOptionRef.current() as EChartsOption, true);
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
      grid: { left: 58, right: 18, top: 12, bottom: 36 },
      tooltip: {
        backgroundColor: c.ink,
        borderColor: c.ink,
        textStyle: { color: c.paper, fontFamily: "JetBrains Mono", fontSize: 12 },
        formatter: (p: { value: [number, number, number, string] }) =>
          `<b style="font-family:serif;font-style:italic;font-size:14px">${p.value[3]}</b><br/>${new Date(p.value[0]).toISOString().slice(0, 10)} · ${p.value[1].toFixed(2)} LD`,
      },
      xAxis: {
        type: "time",
        axisLine: { lineStyle: { color: c.ink3 } },
        axisLabel: { color: c.ink2, fontSize: 11, fontFamily: "JetBrains Mono" },
        splitLine: { show: false },
      },
      yAxis: {
        type: "log",
        logBase: 10,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: c.ink2, fontSize: 11, fontFamily: "JetBrains Mono", formatter: (v: number) => v + " LD" },
        splitLine: { lineStyle: { color: c.rule } },
      },
      series: [
        {
          name: "safe",
          type: "scatter",
          data: safe,
          // bigger bubbles: min 10px, scales with diameter, max 38px
          symbolSize: (v: number[]) => Math.max(10, Math.min(38, Math.log10(v[2] + 0.01) * 9 + 16)),
          itemStyle: { color: c.ink2, opacity: 0.55 },
        },
        {
          name: "haz",
          type: "scatter",
          data: haz,
          symbolSize: (v: number[]) => Math.max(14, Math.min(46, Math.log10(v[2] + 0.01) * 9 + 20)),
          itemStyle: { color: c.signal, opacity: 0.90 },
        },
        {
          type: "line",
          silent: true,
          markLine: {
            symbol: "none",
            silent: true,
            lineStyle: { color: c.signal, opacity: 0.45, width: 1 },
            label: { color: c.signal, fontFamily: "JetBrains Mono", fontSize: 10, formatter: "NOW", position: "insideEndTop" },
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
            label: { color: c.ink3, fontFamily: "JetBrains Mono", fontSize: 10, formatter: "moon · 1 LD", position: "insideEndTop" },
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
      { min: 1, max: Infinity, label: ">1 km" },
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
      grid: { left: 32, right: 12, top: 36, bottom: 38 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(232,232,228,0.04)" } },
        backgroundColor: c.ink,
        borderColor: c.ink,
        textStyle: { color: c.paper, fontFamily: "JetBrains Mono", fontSize: 12 },
        formatter: (params: Array<{ seriesName: string; value: number; marker: string }>) =>
          params.map((p) => `${p.marker} ${p.seriesName}: <b>${p.value}</b>`).join("<br/>"),
      },
      xAxis: {
        type: "category",
        data: bins.map((b) => b.label),
        axisLine: { lineStyle: { color: c.ink3 } },
        axisTick: { show: false },
        axisLabel: { color: c.ink2, fontSize: 12, fontFamily: "JetBrains Mono", interval: 0 },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        // 20% headroom above tallest bar so it never clips
        max: (v: { max: number }) => Math.ceil(v.max * 1.22),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: c.ink2, fontSize: 11, fontFamily: "JetBrains Mono" },
        splitLine: { lineStyle: { color: c.rule } },
      },
      series: [
        {
          name: "Sicuri",
          type: "bar",
          stack: "x",
          data: safe,
          // Desaturated warm tone — same ink family, low opacity
          itemStyle: { color: "rgba(200,198,192,0.28)", borderColor: "rgba(200,198,192,0.45)", borderWidth: 1 },
          barWidth: "52%",
          emphasis: { itemStyle: { color: "rgba(200,198,192,0.45)" } },
        },
        {
          name: "Pericolosi",
          type: "bar",
          stack: "x",
          data: haz,
          // Full signal red — only color that pops
          itemStyle: { color: c.signal, opacity: 0.88 },
          barWidth: "52%",
          emphasis: { itemStyle: { opacity: 1 } },
        },
      ],
    };
  };

  const ref = useEChart(buildOption, [data]);
  return <div ref={ref} className="echart" />;
}
