"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { getFeed, getHealth, getNeo } from "../lib/api";
import { DEFAULT_DAYS } from "../lib/constants";
import type {
  FeedEvent,
  FeedResponse,
  HealthResponse,
  NeoDetailResponse,
} from "../lib/types";
import { DistanceOverTimeChart, SizeHistogram } from "./charts";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type Page = "now" | "catalog" | "states" | "settings";
type HazardFilter = "all" | "yes" | "no";
type SortKey = "date" | "distance" | "size" | "velocity";

interface DashboardClientProps {
  standaloneNeoId?: string;
}

interface Filters {
  hazard: HazardFilter;
  sort: SortKey;
}

// ─────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────
const MONTHS_SHORT = ["gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic"];
const MONTHS_LONG = ["gennaio","febbraio","marzo","aprile","maggio","giugno","luglio","agosto","settembre","ottobre","novembre","dicembre"];

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2,"0")} ${MONTHS_SHORT[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
}
function fmtDateFull(iso: string) {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function fmtDateMD(iso: string) {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2,"0")}.${String(d.getUTCMonth()+1).padStart(2,"0")}`;
}
function fmtTime(iso: string) {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")} UTC`;
}
function fmtKm(n: number) {
  if (n >= 1e6) return (n/1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n/1e3).toFixed(0) + "k";
  return n.toFixed(0);
}
function fmtKmFull(n: number) {
  return Math.round(n).toLocaleString("it-IT");
}
function utcString(d: Date) {
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth()+1).padStart(2,"0")}.${String(d.getUTCDate()).padStart(2,"0")} · ${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}:${String(d.getUTCSeconds()).padStart(2,"0")} UTC`;
}

function ApproachTable({ rows }: { rows: NeoDetailResponse["close_approach_data"] }) {
  return (
    <table className="history">
      <thead>
        <tr><th>Data</th><th>Distanza</th><th>Velocità</th><th>Corpo</th></tr>
      </thead>
      <tbody>
        {rows.map((h, i) => {
          const hKm = h.miss_distance ? parseFloat((h.miss_distance as Record<string, string>).kilometers ?? "0") : null;
          const hVel = h.relative_velocity ? parseFloat((h.relative_velocity as Record<string, string>).kilometers_per_second ?? "0") : null;
          return (
            <tr key={i}>
              <td>{h.close_approach_date_full ? fmtDate(h.close_approach_date_full) : h.close_approach_date}</td>
              <td>{hKm !== null ? `${fmtKmFull(hKm)} km` : "—"}</td>
              <td>{hVel !== null ? `${hVel.toFixed(2)} km/s` : "—"}</td>
              <td className="body">{h.orbiting_body}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function getDefaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - DEFAULT_DAYS + 1);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

// ─────────────────────────────────────────────────────────────
// Utility: hex color → "r,g,b" string for rgba() usage in canvas
// ─────────────────────────────────────────────────────────────
function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

// ─────────────────────────────────────────────────────────────
// Live UTC clock
// ─────────────────────────────────────────────────────────────
function useUtcClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// ─────────────────────────────────────────────────────────────
// Orbit canvas — 2D animated Earth-centric view
// ─────────────────────────────────────────────────────────────
interface HoverInfo {
  a: FeedEvent;
  x: number;
  y: number;
  fromList?: boolean;
}

interface CanvasPosition {
  a: FeedEvent;
  x: number;
  y: number;
  size: number;
  ld: number;
}

interface CanvasRef extends HTMLCanvasElement {
  _positions?: CanvasPosition[];
}

interface OrbitCanvasProps {
  data: FeedEvent[];
  t: number;
  activeId: string | null;
  onPick: (a: FeedEvent) => void;
  onHover: (info: HoverInfo | null) => void;
}

function OrbitCanvas({ data, t, activeId, onPick, onHover }: OrbitCanvasProps) {
  const canvasRef = useRef<CanvasRef>(null);
  const rafRef = useRef<number>(0);

  const angles = useMemo(() => {
    const m: Record<string, number> = {};
    data.forEach((a) => {
      const seed = parseInt(a.id, 10) % 1000;
      m[a.id] = (seed / 1000) * Math.PI * 2;
    });
    return m;
  }, [data]);

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const cx = W / 2, cy = H / 2;
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue("--ink").trim() || "#ededea";
    const ink2 = css.getPropertyValue("--ink-2").trim() || "#8a8a85";
    const ink3 = css.getPropertyValue("--ink-3").trim() || "#4a4a48";
    const rule = css.getPropertyValue("--rule").trim() || "rgba(237,237,234,0.12)";
    const signal = css.getPropertyValue("--signal").trim() || "#ff2d2d";

    const maxRpx = Math.min(W, H) / 2 - 24;
    const minRpx = 22;
    const logMin = Math.log10(0.3);
    const logMax = Math.log10(80);
    const scaleR = (ld: number) => {
      const lv = Math.log10(Math.max(0.3, Math.min(80, ld)));
      return minRpx + ((lv - logMin) / (logMax - logMin)) * (maxRpx - minRpx);
    };

    // Rings — bolder
    const ringLDs = [1, 5, 20, 60];
    ringLDs.forEach((ld, idx) => {
      const r = scaleR(ld);
      ctx.lineWidth = idx === 0 ? 1.5 : 1;
      ctx.strokeStyle = idx === 0
        ? `rgba(${ink3.startsWith("#") ? hexToRgb(ink3) : "74,74,72"}, 0.6)`
        : rule;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = ink3;
      ctx.font = "bold 11px JetBrains Mono, monospace";
      ctx.textAlign = "left";
      ctx.fillText(`${ld} LD`, cx + r + 7, cy - 3);
    });

    // Crosshair
    ctx.lineWidth = 1;
    ctx.strokeStyle = rule;
    ctx.setLineDash([3, 8]);
    ctx.beginPath();
    ctx.moveTo(cx - maxRpx - 10, cy); ctx.lineTo(cx + maxRpx + 10, cy);
    ctx.moveTo(cx, cy - maxRpx - 10); ctx.lineTo(cx, cy + maxRpx + 10);
    ctx.stroke();
    ctx.setLineDash([]);

    // Earth — bigger and bolder
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(cx, cy, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = ink2;
    ctx.font = "bold 11px JetBrains Mono, monospace";
    ctx.fillText("EARTH", cx + 22, cy + 4);

    const positions: CanvasPosition[] = [];

    data.forEach((a) => {
      const ca = a.close_approach;
      const approachT = ca.epoch_date_close_approach;
      const baseLD = parseFloat(ca.miss_distance.lunar ?? "0");
      const offsetDays = Math.abs(t - approachT) / 86400000;
      const ld = baseLD + Math.pow(offsetDays, 1.4) * 0.8;

      const angle = angles[a.id] + ((t - approachT) / 86400000) * 0.04;
      const r = scaleR(ld);
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      const size = Math.max(4, Math.min(14, Math.log10(a.estimated_diameter.kilometers.estimated_diameter_max + 0.01) * 3.5 + 7));

      positions.push({ a, x, y, size, ld });

      // Tail toward earth
      const tailIntensity = Math.max(0, 1 - offsetDays / 12);
      if (tailIntensity > 0.05) {
        ctx.strokeStyle = a.is_potentially_hazardous_asteroid ? signal : ink2;
        ctx.globalAlpha = tailIntensity * 0.4;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Halo for hazardous
      if (a.is_potentially_hazardous_asteroid) {
        const pulseScale = 1 + Math.sin(Date.now() / 340) * 0.18;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = signal;
        ctx.globalAlpha = 0.42;
        ctx.beginPath();
        ctx.arc(x, y, size * 2.8 * pulseScale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Dot
      ctx.fillStyle = a.is_potentially_hazardous_asteroid ? signal : ink;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();

      // Active ring + label
      if (activeId === a.id) {
        ctx.strokeStyle = signal;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, size + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = ink;
        ctx.font = "italic 13px 'Source Serif 4', Georgia, serif";
        ctx.textAlign = "left";
        ctx.fillText(a.name, x + size + 10, y + 4);
      }
    });

    (canvasRef.current as CanvasRef)._positions = positions;
  }, [data, t, activeId, angles]);

  useEffect(() => {
    const loop = () => {
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  const handleMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const pos = cv._positions || [];
    let hit: CanvasPosition | null = null;
    let hitDist = 14;
    for (const p of pos) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < hitDist) { hit = p; hitDist = d; }
    }
    onHover(hit ? { a: hit.a, x: e.clientX, y: e.clientY } : null);
    cv.style.cursor = hit ? "pointer" : "crosshair";
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const pos = cv._positions || [];
    for (const p of pos) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < 14) { onPick(p.a); return; }
    }
  };

  return (
    <canvas
      ref={canvasRef}
      className="orbit-canvas"
      onMouseMove={handleMove}
      onMouseLeave={() => onHover(null)}
      onClick={handleClick}
    />
  );
}

// ─────────────────────────────────────────────────────────────
// Detail panel
// ─────────────────────────────────────────────────────────────
interface DetailProps {
  neo: NeoDetailResponse;
  onClose: () => void;
}

function Detail({ neo, onClose }: DetailProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ca = neo.close_approach_data[0];
  const dia = neo.estimated_diameter.kilometers;
  const od = neo.orbital_data as Record<string, unknown>;
  const orbitClass = od.orbit_class as Record<string, string> | undefined;

  const missLunar = ca?.miss_distance ? parseFloat((ca.miss_distance as Record<string,string>).lunar ?? "0") : null;
  const missKm = ca?.miss_distance ? parseFloat((ca.miss_distance as Record<string,string>).kilometers ?? "0") : null;
  const missAU = ca?.miss_distance ? parseFloat((ca.miss_distance as Record<string,string>).astronomical ?? "0") : null;
  const velKps = ca?.relative_velocity ? parseFloat((ca.relative_velocity as Record<string,string>).kilometers_per_second ?? "0") : null;
  const approachDateFull = ca?.close_approach_date_full ?? ca?.close_approach_date ?? "";

  return (
    <div className="detail-overlay">
      <div className="scrim" onClick={onClose} />
      <aside className="detail">
        <div className="detail-inner">
          <div className="top">
            <div>
              <div className="label">
                {orbitClass ? `${orbitClass.orbit_class_type} · ${orbitClass.orbit_class_description ?? orbitClass.orbit_class_type} class · ` : ""}
                id {neo.id}
              </div>
              <h1>{neo.name}</h1>
              <div className="label" style={{ color: "var(--ink-2)" }}>
                Avvicinamento{" "}
                <b style={{ color: "var(--ink)" }}>
                  {approachDateFull ? fmtDateFull(approachDateFull) : ca?.close_approach_date ?? "—"}
                </b>
                {approachDateFull ? ` · ${fmtTime(approachDateFull)}` : ""}
              </div>
            </div>
            <button className="close" onClick={onClose}>chiudi · esc</button>
          </div>

          {neo.is_potentially_hazardous_asteroid ? (
            <div className="haz-banner">
              <span>○ Potenzialmente pericoloso</span>
              <span>{neo.is_sentry_object ? "Sentry tracked" : "Routine watch"}</span>
            </div>
          ) : (
            <div className="haz-banner" style={{ borderColor: "var(--rule-strong)", color: "var(--ink-2)" }}>
              <span>Nessuna minaccia</span>
              <span>Routine</span>
            </div>
          )}

          <div className="figures">
            <div className="fig">
              <div className="l">Distanza minima</div>
              <div className="v">
                {missLunar !== null ? missLunar.toFixed(2) : "—"}
                <span className="unit">LD</span>
              </div>
              <div className="sub">
                {missKm !== null ? `${fmtKmFull(missKm)} km` : ""}
                {missAU !== null ? ` · ${missAU.toFixed(5)} AU` : ""}
              </div>
            </div>
            <div className="fig">
              <div className="l">Velocità relativa</div>
              <div className="v">
                {velKps !== null ? velKps.toFixed(2) : "—"}
                <span className="unit">km/s</span>
              </div>
              <div className="sub">
                {velKps !== null ? `${(velKps * 3600).toFixed(0)} km/h` : ""}
              </div>
            </div>
            <div className="fig">
              <div className="l">Diametro stimato</div>
              <div className="v">
                {(dia.estimated_diameter_max * 1000).toFixed(0)}
                <span className="unit">m</span>
              </div>
              <div className="sub">
                min {(dia.estimated_diameter_min * 1000).toFixed(0)} m ·
                σ {((dia.estimated_diameter_max - dia.estimated_diameter_min) / 2 * 1000).toFixed(0)} m
              </div>
            </div>
            <div className="fig">
              <div className="l">Magnitudine assoluta</div>
              <div className="v">
                {neo.absolute_magnitude_h ?? "—"}
                <span className="unit">H</span>
              </div>
              <div className="sub">
                {orbitClass ? `classe ${orbitClass.orbit_class_description ?? orbitClass.orbit_class_type}` : ""}
              </div>
            </div>
          </div>

          <div className="section-h">
            <h3>Elementi orbitali</h3>
            <span className="n">orbital_data</span>
          </div>
          <div className="orbital-grid">
            {[
              ["Semi-asse maggiore", od.semi_major_axis as string, "AU"],
              ["Eccentricità", od.eccentricity as string, ""],
              ["Inclinazione", od.inclination as string, "°"],
              ["Periodo orbitale", od.orbital_period ? (parseFloat(od.orbital_period as string)).toFixed(0) : "—", "g"],
              ["Prima osservazione", od.first_observation_date as string, ""],
              ["Osservazioni", od.observations_used as string, ""],
            ].map(([label, value, unit]) => (
              <div className="cell" key={label as string}>
                <div className="l">{label}</div>
                <div className="v">
                  {value ?? "—"}
                  {unit ? <small>{unit}</small> : null}
                </div>
              </div>
            ))}
          </div>

          {/* Split close_approach_data into future (upcoming) and past (historical) */}
          {(() => {
            const now = Date.now();
            const all = neo.close_approach_data;
            const future = all.filter((h) => {
              const d = h.close_approach_date_full ?? h.close_approach_date;
              return d ? new Date(d).getTime() >= now : false;
            }).slice(0, 8);
            const past = all.filter((h) => {
              const d = h.close_approach_date_full ?? h.close_approach_date;
              return d ? new Date(d).getTime() < now : true;
            }).slice(-8).reverse();

            return (
              <>
                {future.length > 0 && (
                  <>
                    <div className="section-h">
                      <h3>Prossimi avvicinamenti</h3>
                      <span className="n">upcoming · {future.length}</span>
                    </div>
                    <ApproachTable rows={future} />
                  </>
                )}
                {past.length > 0 && (
                  <>
                    <div className="section-h" style={{ marginTop: future.length > 0 ? 28 : 0 }}>
                      <h3>Avvicinamenti storici</h3>
                      <span className="n">close_approach_data · {past.length}</span>
                    </div>
                    <ApproachTable rows={past} />
                  </>
                )}
                {future.length === 0 && past.length === 0 && (
                  <div className="section-h">
                    <h3>Nessun dato di avvicinamento</h3>
                    <span className="n">—</span>
                  </div>
                )}
              </>
            );
          })()}

          <a className="jpl" href={neo.nasa_jpl_url} target="_blank" rel="noreferrer">
            NASA JPL Small-Body DB <span className="arr">↗</span>
          </a>
        </div>
      </aside>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// FiltersAndTable
// ─────────────────────────────────────────────────────────────
interface FiltersAndTableProps {
  filtered: FeedEvent[];
  loading: boolean;
  rangeError: string | null;
  filters: Filters;
  setFilters: (f: Filters) => void;
  dateRange: { start: string; end: string };
  setDateRange: (r: { start: string; end: string }) => void;
  onPick: (a: FeedEvent) => void;
  activeId: string | null;
  defaultRange: { start: string; end: string };
}

function FiltersAndTable({
  filtered, loading, rangeError, filters, setFilters,
  dateRange, setDateRange, onPick, activeId, defaultRange,
}: FiltersAndTableProps) {
  const setF = (k: keyof Filters, v: string) =>
    setFilters({ ...filters, [k]: v });

  const maxDist = Math.max(...filtered.map(a => parseFloat(a.close_approach.miss_distance.lunar ?? "0")), 1);
  const maxSize = Math.max(...filtered.map(a => a.estimated_diameter.kilometers.estimated_diameter_max), 0.01);

  return (
    <>
      <div className="filters">
        <div className="group">
          <b>Pericolo</b>
          {(["all","yes","no"] as HazardFilter[]).map((v) => (
            <button
              key={v}
              className={"chip" + (filters.hazard === v ? " active" : "") + (v === "yes" ? " danger" : "")}
              onClick={() => setF("hazard", v)}
            >
              {v === "all" ? "tutti" : v === "yes" ? "pericolosi" : "sicuri"}
            </button>
          ))}
        </div>
        <div className="group">
          <b>Sort</b>
          {(["date","distance","size","velocity"] as SortKey[]).map((s) => (
            <button
              key={s}
              className={"chip" + (filters.sort === s ? " active" : "")}
              onClick={() => setF("sort", s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="group">
          <b>Range</b>
          <input
            type="date"
            value={dateRange.start}
            onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
          />
          <span className="arrow">→</span>
          <input
            type="date"
            value={dateRange.end}
            onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
          />
        </div>
        <span className="grow" />
        <span>
          <b>Risultati</b>{" "}
          <span className="count">{String(filtered.length).padStart(3, "0")}</span>
        </span>
      </div>

      {rangeError ? (
        <div className="state error">
          <div className="glyph">×</div>
          <h3>{rangeError}</h3>
          <p>Il backend rifiuta range &gt; 365 giorni o invertiti. Spezzerà comunque i range validi in chunk da 7 giorni.</p>
          <div className="actions">
            <button className="btn solid" onClick={() => setDateRange(defaultRange)}>Reset range</button>
          </div>
        </div>
      ) : loading ? (
        <div style={{ paddingTop: 16 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div className="skel" key={i} style={{ height: 46, marginBottom: 1 }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="state">
          <div className="glyph">Ø</div>
          <h3>Nessun NEO nel range</h3>
          <p>L&apos;API non ha registrato avvicinamenti per l&apos;intervallo selezionato.</p>
          <div className="actions">
            <button className="btn solid" onClick={() => setDateRange(defaultRange)}>Reset range</button>
          </div>
        </div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Asteroide</th>
              <th>Avvicinamento</th>
              <th>Distanza minima</th>
              <th>Ø stimato</th>
              <th>Velocità</th>
              <th>Stato</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => {
              const ca = a.close_approach;
              const dia = a.estimated_diameter.kilometers;
              const haz = a.is_potentially_hazardous_asteroid;
              const lunar = parseFloat(ca.miss_distance.lunar ?? "0");
              const km = parseFloat(ca.miss_distance.kilometers);
              const vel = parseFloat(ca.relative_velocity.kilometers_per_second);
              return (
                <tr
                  key={a.id}
                  className={activeId === a.id ? "active" : ""}
                  onClick={() => onPick(a)}
                >
                  <td>
                    <div className="name">{a.name}</div>
                    <div className="id">id {a.id} · {String((a.orbital_data as Record<string,unknown>)?.orbit_class_type ?? "")}</div>
                  </td>
                  <td>
                    {fmtDate(ca.close_approach_date_full ?? ca.close_approach_date)}
                    <div className="ink-2" style={{ fontSize: 10, letterSpacing: "0.1em" }}>
                      {ca.close_approach_date_full ? fmtTime(ca.close_approach_date_full) : ""}
                    </div>
                  </td>
                  <td>
                    <div className={"bar-cell" + (haz ? " danger" : "")}>
                      <span>
                        {lunar.toFixed(2)} LD{" "}
                        <span className="ink-2">· {fmtKm(km)} km</span>
                      </span>
                      <div className="bar">
                        <span style={{ width: `${Math.min(100, (lunar / maxDist) * 100)}%` }} />
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className={"bar-cell" + (haz ? " danger" : "")}>
                      <span>
                        {(dia.estimated_diameter_max * 1000).toFixed(0)}{" "}
                        <span className="ink-2">m</span>
                      </span>
                      <div className="bar">
                        <span style={{ width: `${Math.min(100, (dia.estimated_diameter_max / maxSize) * 100)}%` }} />
                      </div>
                    </div>
                  </td>
                  <td>
                    {vel.toFixed(2)} <span className="ink-2">km/s</span>
                  </td>
                  <td>
                    <div className={"haz-cell" + (haz ? " danger" : "")}>
                      <span className="led" />
                      {haz ? (a.is_sentry_object ? "Sentry" : "Pericoloso") : "Sicuro"}
                    </div>
                  </td>
                  <td><span className="row-arrow">→</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// States page
// ─────────────────────────────────────────────────────────────
function StatesPage() {
  return (
    <>
      <div className="masthead" style={{ paddingTop: 40, paddingBottom: 24 }}>
        <div>
          <div className="meta-l"><span>Sezione · <b>stati &amp; edge case</b></span></div>
          <h1 style={{ fontSize: "clamp(56px, 7vw, 120px)" }}>
            Quando<br /><span className="it">i dati</span> tacciono
          </h1>
        </div>
      </div>

      <div className="section-label">
        <span className="n">§01</span>
        <h2>Skeleton <span className="it">in attesa</span></h2>
        <span className="r">request pending</span>
      </div>
      <div style={{ paddingTop: 16 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div className="skel" key={i} style={{ height: 46, marginBottom: 1 }} />
        ))}
      </div>

      <div className="section-label">
        <span className="n">§02</span>
        <h2>Rate <span className="it">limit</span></h2>
        <span className="r">HTTP 429</span>
      </div>
      <div className="state error">
        <div className="glyph">429</div>
        <h3>Quota NASA esaurita</h3>
        <p>L&apos;API NeoWs accetta 1.000 chiamate/ora con la chiave personale. Finché la finestra non si resetta, il backend FastAPI continua a servire dalla cache.</p>
        <div className="actions">
          <button className="btn">Mostra cache</button>
          <button className="btn solid">Settings</button>
        </div>
      </div>

      <div className="section-label">
        <span className="n">§03</span>
        <h2>Range <span className="it">troppo lungo</span></h2>
        <span className="r">handled by proxy</span>
      </div>
      <div className="state error">
        <div className="glyph">∞</div>
        <h3>Oltre 365 giorni</h3>
        <p>Il proxy spezza in chunk da 7 giorni fino a un anno. Oltre, la richiesta viene rifiutata per evitare payload eccessivi.</p>
      </div>

      <div className="section-label">
        <span className="n">§04</span>
        <h2>Data <span className="it">non valida</span></h2>
        <span className="r">HTTP 400</span>
      </div>
      <div className="state error">
        <div className="glyph">!</div>
        <h3>Formato non riconosciuto</h3>
        <p>Atteso ISO 8601 · YYYY-MM-DD. Il backend valida prima di inoltrare alla NASA, evitando chiamate sprecate.</p>
      </div>

      <div className="section-label">
        <span className="n">§05</span>
        <h2>Catalogo <span className="it">vuoto</span></h2>
        <span className="r">empty state</span>
      </div>
      <div className="state">
        <div className="glyph">Ø</div>
        <h3>Nessun avvicinamento</h3>
        <p>Possibile ma raro. Prova ad allargare il range o a tornare al periodo predefinito.</p>
      </div>

      <ColophonView />
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Settings / API page
// ─────────────────────────────────────────────────────────────
interface SettingsPageProps {
  health: HealthResponse | null;
}

function SettingsPage({ health }: SettingsPageProps) {
  return (
    <>
      <div className="masthead" style={{ paddingTop: 40, paddingBottom: 24 }}>
        <div>
          <div className="meta-l"><span>Sezione · <b>API &amp; cache</b></span></div>
          <h1 style={{ fontSize: "clamp(56px, 7vw, 120px)" }}>
            Backend<br /><span className="it">contract</span>
          </h1>
        </div>
      </div>

      <div className="kpi-strip">
        <div className="kpi">
          <div className="l">Cache entries</div>
          <div className="v">{health?.cache.entries ?? "—"}<span className="unit" style={{ fontSize: 14 }}> entry</span></div>
          <div className="sub">{health?.cache.size_bytes ? `${(health.cache.size_bytes / 1024).toFixed(0)} KB` : "—"} · TTL 24h</div>
        </div>
        <div className="kpi">
          <div className="l">Cache hit ratio</div>
          <div className="v">
            {health?.cache.hit_ratio !== undefined ? (health.cache.hit_ratio * 100).toFixed(0) : "—"}
            <span className="unit">%</span>
          </div>
          <div className="sub">{health?.cache.expired_entries ?? 0} expired</div>
        </div>
        <div className="kpi">
          <div className="l">Upstream status</div>
          <div className="v" style={{ fontSize: 26 }}>
            {health?.upstream.last_status ?? "—"}
          </div>
          <div className="sub">
            {health?.upstream.last_rate_limit_remaining !== null && health?.upstream.last_rate_limit_remaining !== undefined
              ? `${health.upstream.last_rate_limit_remaining} req rimanenti`
              : "no upstream data"}
          </div>
        </div>
        <div className="kpi">
          <div className="l">Stato proxy</div>
          <div className="v" style={{ fontSize: 26 }}>{health ? "ONLINE" : "—"}</div>
          <div className="sub">FastAPI · backend</div>
        </div>
      </div>

      <div className="section-label">
        <span className="n">§01</span>
        <h2>Endpoint <span className="it">contract</span></h2>
        <span className="r">FastAPI · v1</span>
      </div>
      <div className="endpoints">
        <div className="endpoint">
          <div className="verb">GET</div>
          <div className="path">/api/feed?start_date=YYYY-MM-DD&amp;end_date=YYYY-MM-DD</div>
          <div className="desc">Feed aggregato. Range &gt; 7d → split automatico in chunk paralleli + cache</div>
        </div>
        <div className="endpoint">
          <div className="verb">GET</div>
          <div className="path">/api/neo/{"{id}"}</div>
          <div className="desc">Dettaglio · orbital_data + close_approach storico</div>
        </div>
        <div className="endpoint">
          <div className="verb">GET</div>
          <div className="path">/api/health</div>
          <div className="desc">Stato cache · rate limit residuo · chunks in volo</div>
        </div>
        <div className="endpoint">
          <div className="verb">POST</div>
          <div className="path">/api/cache/invalidate</div>
          <div className="desc">Reset cache · admin</div>
        </div>
      </div>

      <div className="section-label">
        <span className="n">§02</span>
        <h2>Chunking <span className="it">7 giorni</span></h2>
        <span className="r">range &gt; 7d</span>
      </div>
      <div style={{ padding: "20px 0 36px", color: "var(--ink-2)", fontSize: 13, lineHeight: 1.7 }}>
        Il frontend invia{" "}
        <code style={{ color: "var(--ink)" }}>start_date</code> e{" "}
        <code style={{ color: "var(--ink)" }}>end_date</code> arbitrari.
        Il backend calcola{" "}
        <code style={{ color: "var(--ink)" }}>ceil(days / 7)</code> chunk e li lancia in parallelo con{" "}
        <code style={{ color: "var(--ink)" }}> asyncio.gather</code>. Ogni chunk è cache-key indipendente.
        <div style={{ display: "flex", gap: 4, marginTop: 22, flexWrap: "wrap" }}>
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              style={{
                padding: "8px 14px",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 10,
                letterSpacing: "0.18em",
                border: "1px solid var(--rule-strong)",
                background: i < 6 ? "var(--ink)" : "transparent",
                color: i < 6 ? "var(--paper)" : "var(--ink-2)",
                textTransform: "uppercase",
              }}
            >
              chunk · {String(i + 1).padStart(2, "0")} · {i === 8 ? "2d" : "7d"}
            </div>
          ))}
        </div>
      </div>

      <ColophonView />
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Colophon
// ─────────────────────────────────────────────────────────────
function ColophonView() {
  return (
    <footer className="colophon">
      <div>
        <h4>Arkemis NEO Observatory</h4>
        Editorial dashboard per esplorare i Near-Earth Objects della NASA. · 16 - 05 - 2026
      </div>
      <div>
        <h4>Sorgenti</h4>
        NASA · NeoWs API<br />
        JPL Small-Body Database<br />
        Backend · FastAPI · file-cache 24h
      </div>
      <div>
        <h4>Tecnica</h4>
        React 19 · ECharts 5 · Canvas 2D<br />
        Type · Source Serif 4 · JetBrains Mono<br />
        v0.3.0 · build 2025.05
      </div>
    </footer>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Dashboard Component
// ─────────────────────────────────────────────────────────────
export function DashboardClient({ standaloneNeoId }: DashboardClientProps) {
  const DEFAULT_RANGE = useMemo(() => getDefaultRange(), []);

  // Theme
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.dispatchEvent(new CustomEvent("arkemis-theme", { detail: theme }));
  }, [theme]);

  // Page navigation
  const [page, setPage] = useState<Page>("now");

  // Date range
  const [dateRange, setDateRange] = useState(DEFAULT_RANGE);

  // Filters
  const [filters, setFilters] = useState<Filters>({ hazard: "all", sort: "date" });

  // Feed data
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);

  // Health
  const [health, setHealth] = useState<HealthResponse | null>(null);

  // Detail panel
  const [pickedId, setPickedId] = useState<string | null>(standaloneNeoId ?? null);
  const [pickedEvent, setPickedEvent] = useState<FeedEvent | null>(null);
  const [detail, setDetail] = useState<NeoDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Canvas hover
  const [hovered, setHovered] = useState<HoverInfo | null>(null);

  // Clock
  const clock = useUtcClock();

  // Time scrubber
  const rangeStart = useMemo(() => new Date(dateRange.start).getTime(), [dateRange.start]);
  const rangeEnd = useMemo(() => new Date(dateRange.end).getTime() + 86400000, [dateRange.end]);
  const [t, setT] = useState(rangeStart);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [rosterExpanded, setRosterExpanded] = useState(false);
  useEffect(() => { setT(rangeStart); }, [rangeStart]);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const dt = now - last; last = now;
      setT((prev) => {
        const step = dt * 86400000 / 8000 * speed;
        let next = prev + step;
        if (next > rangeEnd) next = rangeStart;
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, rangeStart, rangeEnd]);

  // Range error
  const rangeError = useMemo(() => {
    const s = new Date(dateRange.start), e = new Date(dateRange.end);
    if (isNaN(+s) || isNaN(+e)) return "Data non valida";
    if (e < s) return "Range invertito";
    if ((e.getTime() - s.getTime()) / 86400000 > 365) return "Oltre 365 giorni";
    return null;
  }, [dateRange]);

  // Fetch feed
  useEffect(() => {
    if (rangeError) return;
    const ac = new AbortController();
    setFeedLoading(true);
    setFeedError(null);
    getFeed(dateRange.start, dateRange.end, ac.signal)
      .then((data) => { setFeed(data); setFeedLoading(false); })
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          setFeedError(err.message ?? "Errore di rete");
          setFeedLoading(false);
        }
      });
    return () => ac.abort();
  }, [dateRange, rangeError]);

  // Fetch health
  useEffect(() => {
    const ac = new AbortController();
    getHealth(ac.signal).then(setHealth).catch(() => {});
    return () => ac.abort();
  }, []);

  // Fetch detail when pickedId changes
  useEffect(() => {
    if (!pickedId) { setDetail(null); return; }
    const ac = new AbortController();
    setDetailLoading(true);
    getNeo(pickedId, ac.signal)
      .then((data) => { setDetail(data); setDetailLoading(false); })
      .catch((err: Error) => {
        if (err.name !== "AbortError") { setDetail(null); setDetailLoading(false); }
      });
    return () => ac.abort();
  }, [pickedId]);

  // Filtered & sorted list
  const filtered = useMemo(() => {
    if (!feed || rangeError) return [];
    let list = [...feed.near_earth_objects];
    if (filters.hazard === "yes") list = list.filter((a) => a.is_potentially_hazardous_asteroid);
    if (filters.hazard === "no") list = list.filter((a) => !a.is_potentially_hazardous_asteroid);
    list.sort((a, b) => {
      const ca = a.close_approach, cb = b.close_approach;
      switch (filters.sort) {
        case "distance":
          return parseFloat(ca.miss_distance.lunar ?? "0") - parseFloat(cb.miss_distance.lunar ?? "0");
        case "size":
          return b.estimated_diameter.kilometers.estimated_diameter_max - a.estimated_diameter.kilometers.estimated_diameter_max;
        case "velocity":
          return parseFloat(cb.relative_velocity.kilometers_per_second) - parseFloat(ca.relative_velocity.kilometers_per_second);
        default:
          return ca.epoch_date_close_approach - cb.epoch_date_close_approach;
      }
    });
    return list;
  }, [feed, filters, rangeError]);

  // Stats
  const hazCount = useMemo(() => filtered.filter((a) => a.is_potentially_hazardous_asteroid).length, [filtered]);
  const closest = useMemo(() =>
    filtered.reduce<FeedEvent | null>((m, a) =>
      !m || parseFloat(a.close_approach.miss_distance.lunar ?? "0") < parseFloat(m.close_approach.miss_distance.lunar ?? "0") ? a : m,
    null), [filtered]);
  const largest = useMemo(() =>
    filtered.reduce<FeedEvent | null>((m, a) =>
      !m || a.estimated_diameter.kilometers.estimated_diameter_max > m.estimated_diameter.kilometers.estimated_diameter_max ? a : m,
    null), [filtered]);
  const nextApproach = useMemo(() => {
    const now = Date.now();
    return filtered.find((a) => a.close_approach.epoch_date_close_approach >= now) ?? filtered[0];
  }, [filtered]);

  // Marquee items
  const marqueeItems = useMemo(() =>
    filtered.filter((a) => a.is_potentially_hazardous_asteroid).slice(0, 10),
  [filtered]);

  // Active orbit id
  const orbitActiveId = (hovered?.a ?? pickedEvent)?.id ?? null;

  // Scrubber click
  const onScrubClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setT(rangeStart + ratio * (rangeEnd - rangeStart));
    setPlaying(false);
  };

  const handlePick = (a: FeedEvent) => {
    setPickedEvent(a);
    setPickedId(a.id);
  };

  const handleClose = () => {
    setPickedId(null);
    setPickedEvent(null);
    setDetail(null);
  };

  return (
    <div className="page">
      {/* Utility bar */}
      <div className="util">
        <div className="brand" onClick={() => setPage("now")} style={{ cursor: "pointer" }} aria-label="NEO Observatory">
          <span className="brand-logo-set" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logos/neo_logo_extended_dark_crop.png"
              alt=""
              className="brand-logo brand-logo-desktop brand-logo-dark"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logos/neo_logo_extended_light_crop.png"
              alt=""
              className="brand-logo brand-logo-desktop brand-logo-light"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logos/neo_logo_mobile_dark_crop.png"
              alt=""
              className="brand-logo brand-logo-mobile brand-logo-dark"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logos/neo_logo_mobile_light_crop.png"
              alt=""
              className="brand-logo brand-logo-mobile brand-logo-light"
            />
          </span>
        </div>
        <nav>
          {(["now","catalog","states","settings"] as Page[]).map((p) => (
            <button
              key={p}
              className={page === p ? "active" : ""}
              onClick={() => setPage(p)}
            >
              {p === "now" ? "Now" : p === "catalog" ? "Catalogo" : p === "states" ? "Stati" : "API"}
            </button>
          ))}
        </nav>
        <button
          className={"theme-switch" + (theme === "light" ? " is-light" : "")}
          onClick={() => setTheme((th) => th === "dark" ? "light" : "dark")}
          title={theme === "dark" ? "Modalità chiara" : "Modalità scura"}
          aria-label="Toggle light/dark mode"
        >
          <span className="ts-thumb" />
        </button>
      </div>

      {/* Marquee */}
      {marqueeItems.length > 0 && (
        <div className="marquee">
          <div className="marquee-track">
            {[...marqueeItems, ...marqueeItems].map((a, i) => (
              <span className="item" key={i}>
                <span className="red">⦿</span>&nbsp;&nbsp;
                <span className="ink">{a.name}</span>
                {parseFloat(a.close_approach.miss_distance.lunar ?? "0").toFixed(2)} LD ·
                Ø {(a.estimated_diameter.kilometers.estimated_diameter_max * 1000).toFixed(0)} m ·
                {fmtDateMD(a.close_approach.close_approach_date_full ?? a.close_approach.close_approach_date)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Page: now */}
      {page === "now" && (
        <>
          <header className="masthead">
            <div className="masthead-top">
              <div className="meta-l">
                <span>Range <b>{dateRange.start}</b> → <b>{dateRange.end}</b></span>
                <span>Sorgente <b>NASA · NeoWs</b></span>
                {feed?.meta.chunk_count ? <span>Chunks <b>{feed.meta.chunk_count}</b> · {feed.meta.cache.hits} cached</span> : null}
              </div>
              <div className="meta-r">
                <b>Prossimo avvicinamento</b>
                {nextApproach ? (
                  <>
                    <span className="big">
                      {fmtDate(nextApproach.close_approach.close_approach_date_full ?? nextApproach.close_approach.close_approach_date)}
                    </span>
                    {nextApproach.name} · {parseFloat(nextApproach.close_approach.miss_distance.lunar ?? "0").toFixed(2)} LD
                  </>
                ) : "—"}
              </div>
            </div>
            <h1>Near<span className="ampersand">·</span>Earth <span className="it">Objects</span></h1>
          </header>

          {/* KPI strip */}
          <div className="kpi-strip">
            <div className="kpi">
              <div className="l">Tracciati</div>
              <div className="v">
                {String(filtered.length).padStart(2, "0")}
                <span className="sup">/ {feed?.stats.total ?? "—"}</span>
              </div>
              <div className="sub">nel range · {((rangeEnd - rangeStart) / 86400000).toFixed(0)} giorni</div>
            </div>
            <div className={"kpi" + (hazCount > 0 ? " danger" : "")}>
              <div className="l">Pericolosi</div>
              <div className="v">
                {String(hazCount).padStart(2, "0")}
                <span className="sup">/ {filtered.length}</span>
              </div>
              <div className="sub">{filtered.length > 0 ? `${((hazCount / filtered.length) * 100).toFixed(0)}% del totale` : "—"}</div>
            </div>
            <div className="kpi">
              <div className="l">Più vicino</div>
              <div className="v">
                {closest ? parseFloat(closest.close_approach.miss_distance.lunar ?? "0").toFixed(2) : "—"}
                <span className="unit">LD</span>
              </div>
              <div className="sub">{closest?.name ?? ""}</div>
            </div>
            <div className="kpi">
              <div className="l">Più grande</div>
              <div className="v">
                {largest ? (largest.estimated_diameter.kilometers.estimated_diameter_max * 1000).toFixed(0) : "—"}
                <span className="unit">m</span>
              </div>
              <div className="sub">{largest?.name ?? ""}</div>
            </div>
          </div>

          {/* Feed error state */}
          {feedError && !feedLoading && (
            <div className="state error">
              <div className="glyph">!</div>
              <h3>Errore di connessione</h3>
              <p>{feedError}</p>
              <div className="actions">
                <button className="btn solid" onClick={() => setDateRange({ ...dateRange })}>Riprova</button>
              </div>
            </div>
          )}

          {/* §01 Live orbit */}
          {!feedError && (
            <>
              <div className="section-label">
                <span className="n">§01</span>
                <h2>Live <span className="it">orbit</span></h2>
                <span className="r">2D · Earth-centric · log scale</span>
              </div>

              <div className="orbit-wrap">
                <div className="orbit-stage">
                  {feedLoading ? (
                    <div className="skel" style={{ position: "absolute", inset: 0 }} />
                  ) : (
                    <OrbitCanvas
                      data={filtered}
                      t={t}
                      activeId={orbitActiveId}
                      onPick={handlePick}
                      onHover={setHovered}
                    />
                  )}
                  <div className="orbit-overlay">
                    <div className="tl">
                      <b>Now</b><br />
                      {Number.isFinite(t) ? `${fmtDate(new Date(t).toISOString())} · ${fmtTime(new Date(t).toISOString())}` : "—"}
                    </div>
                    <div className="tr">
                      <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: "var(--signal)", verticalAlign: "middle", marginRight: 7 }} />
                      Pericoloso<br />
                      <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: "var(--ink)", opacity: 0.6, verticalAlign: "middle", marginRight: 7 }} />
                      Sicuro<br />
                      <span style={{ opacity: 0.5 }}>Ø&thinsp;=&thinsp;diametro</span>
                    </div>
                    <div className="bl">
                      Anelli &nbsp;1·5·20·60 LD<br />
                      1 LD = 384,400 km
                    </div>
                    <div className="br">
                      Visualizzazione · live<br />
                      {filtered.length} oggetti
                    </div>
                  </div>
                </div>
                <div className="orbit-side">
                  <div className="head">
                    <span>Roster</span>
                    <b>{filtered.length}</b>
                    <span
                      onClick={() => setRosterExpanded(!rosterExpanded)}
                      style={{ marginLeft: 12, cursor: 'pointer', opacity: 0.6, fontSize: 10 }}
                      title={rosterExpanded ? 'Comprimi roster' : 'Espandi roster'}
                    >
                      {rosterExpanded ? '−' : '+'}
                    </span>
                  </div>
                  <div className="roster" style={{ maxHeight: rosterExpanded ? 'calc(22 * 44px)' : 'calc(15 * 44px)' }}>
                    {filtered
                      .slice()
                      .sort((a, b) =>
                        Math.abs(a.close_approach.epoch_date_close_approach - t) -
                        Math.abs(b.close_approach.epoch_date_close_approach - t)
                      )
                      .map((a) => (
                        <div
                          key={a.id}
                          className={
                            "roster-row" +
                            (a.is_potentially_hazardous_asteroid ? " haz" : "") +
                            (orbitActiveId === a.id ? " active" : "")
                          }
                          onMouseEnter={() => setHovered({ a, x: 0, y: 0, fromList: true })}
                          onMouseLeave={() => setHovered(null)}
                          onClick={() => handlePick(a)}
                        >
                          <span className="signal-dot" />
                          <span className="name">{a.name}</span>
                          <span className="dist">
                            {parseFloat(a.close_approach.miss_distance.lunar ?? "0").toFixed(2)} LD
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>

              {/* Scrubber */}
              <div className="scrubber">
                <button className="play" onClick={() => setPlaying((p) => !p)}>
                  {playing ? (
                    <svg viewBox="0 0 12 12">
                      <rect x="2" y="1.5" width="3" height="9" fill="currentColor" />
                      <rect x="7" y="1.5" width="3" height="9" fill="currentColor" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 12 12">
                      <polygon points="2,1 11,6 2,11" fill="currentColor" />
                    </svg>
                  )}
                </button>
                <div className="track" onClick={onScrubClick}>
                  <div className="track-line" />
                  <div className="track-marks">
                    {filtered.map((a) => {
                      const at = a.close_approach.epoch_date_close_approach;
                      const left = ((at - rangeStart) / (rangeEnd - rangeStart)) * 100;
                      return (
                        <div
                          key={a.id}
                          className={"mark" + (a.is_potentially_hazardous_asteroid ? " haz" : "")}
                          style={{ left: `${left}%` }}
                        />
                      );
                    })}
                  </div>
                  <div className="handle" style={{ left: `${((t - rangeStart) / (rangeEnd - rangeStart)) * 100}%` }} />
                </div>
                <div className="date">{Number.isFinite(t) ? fmtDate(new Date(t).toISOString()) : "—"}</div>
                <div className="speed">
                  {[0.5, 1, 3, 10].map((s) => (
                    <button
                      key={s}
                      className={speed === s ? "active" : ""}
                      onClick={() => setSpeed(s)}
                    >
                      {s}×
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="date"
                    value={dateRange.start}
                    onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                  />
                  <span className="arrow" style={{ color: "var(--ink-3)" }}>→</span>
                  <input
                    type="date"
                    value={dateRange.end}
                    onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                  />
                </div>
              </div>

              {/* §02 Charts */}
              <div className="section-label">
                <span className="n">§02</span>
                <h2>Numeri <span className="it">in moto</span></h2>
                <span className="r">scale logaritmiche · NeoWs raw</span>
              </div>
              <div className="charts-row">
                <div className="chart-cell">
                  <div className="chart-meta">
                    <b>Distanza × tempo</b>
                    <span>asse Y · LD log</span>
                  </div>
                  {filtered.length > 0 && <DistanceOverTimeChart data={filtered} currentT={t} />}
                </div>
                <div className="chart-cell">
                  <div className="chart-meta">
                    <b>Distribuzione Ø</b>
                    <span>stack pericolo</span>
                  </div>
                  {filtered.length > 0 && <SizeHistogram data={filtered} />}
                </div>
              </div>

              {/* §03 Catalog */}
              <div className="section-label">
                <span className="n">§03</span>
                <h2>Catalogo <span className="it">esteso</span></h2>
                <span className="r">click riga · scheda dettaglio</span>
              </div>
              <FiltersAndTable
                filtered={filtered}
                loading={feedLoading}
                rangeError={rangeError}
                filters={filters}
                setFilters={setFilters}
                dateRange={dateRange}
                setDateRange={setDateRange}
                onPick={handlePick}
                activeId={pickedEvent?.id ?? null}
                defaultRange={DEFAULT_RANGE}
              />
            </>
          )}

          <ColophonView />
        </>
      )}

      {/* Page: catalog */}
      {page === "catalog" && (
        <>
          <div className="masthead" style={{ paddingTop: 40, paddingBottom: 24 }}>
            <div>
              <div className="meta-l"><span>Sezione · <b>catalogo</b></span></div>
              <h1 style={{ fontSize: "clamp(56px, 7vw, 120px)" }}>
                Catalogo<br /><span className="it">completo</span>
              </h1>
            </div>
          </div>
          <FiltersAndTable
            filtered={filtered}
            loading={feedLoading}
            rangeError={rangeError}
            filters={filters}
            setFilters={setFilters}
            dateRange={dateRange}
            setDateRange={setDateRange}
            onPick={handlePick}
            activeId={pickedEvent?.id ?? null}
            defaultRange={DEFAULT_RANGE}
          />
          <ColophonView />
        </>
      )}

      {/* Page: states */}
      {page === "states" && <StatesPage />}

      {/* Page: settings */}
      {page === "settings" && <SettingsPage health={health} />}

      {/* Detail panel */}
      {pickedId && (
        detailLoading ? (
          <div className="detail-overlay">
            <div className="scrim" onClick={handleClose} />
            <aside className="detail">
              <div className="detail-inner">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div className="skel" key={i} style={{ height: 40, marginBottom: 12 }} />
                ))}
              </div>
            </aside>
          </div>
        ) : detail ? (
          <Detail neo={detail} onClose={handleClose} />
        ) : null
      )}

      {/* Canvas hover tooltip */}
      {hovered && !hovered.fromList && (
        <div className="tooltip" style={{ left: hovered.x, top: hovered.y }}>
          <b>{hovered.a.name}</b><br />
          {parseFloat(hovered.a.close_approach.miss_distance.lunar ?? "0").toFixed(2)} LD ·{" "}
          {parseFloat(hovered.a.close_approach.relative_velocity.kilometers_per_second).toFixed(1)} km/s<br />
          Ø {(hovered.a.estimated_diameter.kilometers.estimated_diameter_max * 1000).toFixed(0)} m
        </div>
      )}
    </div>
  );
}
