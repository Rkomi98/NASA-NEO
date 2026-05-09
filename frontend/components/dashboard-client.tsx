"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { getFeed, getHealth, getNeo } from "../lib/api";
import { DEFAULT_DAYS, HAZARD_FILTERS, SORT_OPTIONS } from "../lib/constants";
import {
  formatDate,
  formatDiameterKm,
  formatKilometers,
  formatNumber,
  formatShortDate,
} from "../lib/formatters";
import type {
  FeedEvent,
  FeedResponse,
  HealthResponse,
  HazardFilter,
  NeoDetailResponse,
  SortKey,
} from "../lib/types";
import {
  DistanceOverTimeChart,
  Orbital3DChart,
  SizeDistributionChart,
} from "./charts";

type Section = "dashboard" | "catalog" | "timeline" | "states" | "settings";
type PageSection = "overview" | "orbits" | "catalog" | "info";

interface DashboardClientProps {
  standaloneNeoId?: string;
}

function getDefaultRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - DEFAULT_DAYS + 1);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function sortItems(items: FeedEvent[], sortKey: SortKey): FeedEvent[] {
  const next = [...items];
  next.sort((a, b) => {
    switch (sortKey) {
      case "miss_distance_km":
        return (
          Number(a.close_approach.miss_distance.kilometers) -
          Number(b.close_approach.miss_distance.kilometers)
        );
      case "diameter_max_km":
        return (
          b.estimated_diameter.kilometers.estimated_diameter_max -
          a.estimated_diameter.kilometers.estimated_diameter_max
        );
      case "relative_velocity_kps":
        return (
          Number(b.close_approach.relative_velocity.kilometers_per_second) -
          Number(a.close_approach.relative_velocity.kilometers_per_second)
        );
      default:
        return (
          a.close_approach.epoch_date_close_approach -
          b.close_approach.epoch_date_close_approach
        );
    }
  });
  return next;
}

function filterItems(items: FeedEvent[], hazardFilter: HazardFilter): FeedEvent[] {
  if (hazardFilter === "hazardous") {
    return items.filter((item) => item.is_potentially_hazardous_asteroid);
  }
  if (hazardFilter === "safe") {
    return items.filter((item) => !item.is_potentially_hazardous_asteroid);
  }
  return items;
}

function classNames(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
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

const ORBITAL_LABELS: Record<string, string> = {
  orbit_id: "ID orbita",
  orbit_determination_date: "Orbita calcolata il",
  first_observation_date: "Prima osservazione",
  last_observation_date: "Ultima osservazione",
  data_arc_in_days: "Arco osservativo",
  observations_used: "Osservazioni usate",
  orbit_uncertainty: "Incertezza orbitale",
  minimum_orbit_intersection: "MOID Terra",
  semi_major_axis: "Semi-asse maggiore",
  eccentricity: "Eccentricita'",
  inclination: "Inclinazione",
  ascending_node_longitude: "Nodo ascendente",
  perihelion_argument: "Argomento del perielio",
  mean_anomaly: "Anomalia media",
  epoch_osculation: "Epoch osculation",
  equinox: "Equinozio",
  orbital_period: "Periodo orbitale",
  perihelion_distance: "Perielio",
  aphelion_distance: "Afelio",
};

function formatOrbitalLabel(key: string): string {
  return ORBITAL_LABELS[key] ?? key.replaceAll("_", " ");
}

function formatOrbitalValue(key: string, value: unknown): string {
  if (value == null) {
    return "--";
  }
  if (typeof value === "object") {
    const orbitClass = value as {
      type?: unknown;
      name?: unknown;
      orbit_class_type?: unknown;
      orbit_class_description?: unknown;
    };
    const type = orbitClass.type ?? orbitClass.orbit_class_type;
    const name = orbitClass.name ?? orbitClass.orbit_class_description;
    if (type || name) {
      return [type, name].filter(Boolean).join(" - ");
    }
    return JSON.stringify(value);
  }
  const text = String(value);
  if (key === "data_arc_in_days") {
    return `${formatNumber(Number(text))} giorni`;
  }
  if (key === "observations_used") {
    return `${formatNumber(Number(text))} osservazioni`;
  }
  if (key === "minimum_orbit_intersection" || key.endsWith("_distance") || key === "semi_major_axis") {
    return `${Number(text).toFixed(4)} AU`;
  }
  if (key === "inclination" || key === "ascending_node_longitude" || key === "perihelion_argument" || key === "mean_anomaly") {
    return `${Number(text).toFixed(2)} deg`;
  }
  if (key === "orbital_period") {
    return `${formatNumber(Number(text), 1)} giorni`;
  }
  return text;
}

function getApproachStatus(value: string): "passato" | "previsto" {
  const approachTime = new Date(value).getTime();
  return approachTime > Date.now() ? "previsto" : "passato";
}

export function DashboardClient({ standaloneNeoId }: DashboardClientProps) {
  const defaults = useMemo(getDefaultRange, []);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [section, setSection] = useState<PageSection>("overview");
  const [hazardFilter, setHazardFilter] = useState<HazardFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("approach_date");
  const [range, setRange] = useState(defaults);
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [detail, setDetail] = useState<NeoDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const activeNeoId = standaloneNeoId ?? searchParams.get("neo_id");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const controller = new AbortController();
    setErrorMessage(null);
    getFeed(range.start, range.end, controller.signal)
      .then(setFeed)
      .catch((error: Error & { status?: number }) => {
        setFeed(null);
        setErrorMessage(error.message);
      });
    return () => controller.abort();
  }, [range]);

  useEffect(() => {
    const controller = new AbortController();
    getHealth(controller.signal).then(setHealth).catch(() => setHealth(null));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!activeNeoId) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    setDetailLoading(true);
    getNeo(activeNeoId, controller.signal)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
    return () => controller.abort();
  }, [activeNeoId]);

  const visibleItems = useMemo(() => {
    if (!feed) {
      return [];
    }
    return sortItems(
      filterItems(feed.near_earth_objects, hazardFilter),
      sortKey,
    );
  }, [feed, hazardFilter, sortKey]);

  const orbitClassSummary = useMemo(() => {
    const counts = new Map<string, number>();
    visibleItems.forEach((item) => {
      const orbitClass = getOrbitClassType(item);
      counts.set(orbitClass, (counts.get(orbitClass) ?? 0) + 1);
    });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [visibleItems]);

  const orbitalStats = useMemo(() => {
    const withOrbit = visibleItems.filter(
      (item) => item.orbital_data.semi_major_axis && item.orbital_data.eccentricity,
    );
    const withInclination = visibleItems.filter((item) => item.orbital_data.inclination);
    const withMoid = visibleItems.filter((item) => item.orbital_data.minimum_orbit_intersection);
    const closeApproachOnly = Math.max(0, visibleItems.length - withOrbit.length);
    return [
      { label: "Orbite NASA complete", value: formatNumber(withOrbit.length), caption: "ellissi disegnate solo con a + e" },
      { label: "Tracce close approach", value: formatNumber(closeApproachOnly), caption: "marker vicino alla Terra del passaggio" },
      { label: "Inclinazioni reali", value: formatNumber(withInclination.length), caption: "usate solo quando NASA le espone" },
      { label: "MOID disponibili", value: formatNumber(withMoid.length), caption: "dato orbitale NASA se presente" },
    ];
  }, [visibleItems]);

  const highlightedOrbitItems = useMemo(
    () =>
      [...visibleItems]
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
        .slice(0, 18),
    [visibleItems],
  );

  function goToSection(nextSection: PageSection) {
    setSection(nextSection);
    document
      .getElementById(`section-${nextSection}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openNeo(event: FeedEvent) {
    if (standaloneNeoId) {
      router.push(`/neo/${event.id}`);
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("neo_id", event.id);
    params.set("approach", event.close_approach.close_approach_date);
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  function closeModal() {
    if (standaloneNeoId) {
      router.push("/");
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.delete("neo_id");
    params.delete("approach");
    router.replace(params.toString() ? `${pathname}?${params.toString()}` : pathname, {
      scroll: false,
    });
  }

  const stats = feed?.stats;
  const summaryCards = [
    {
      label: "Pericolosi rilevati",
      value: stats ? formatNumber(stats.hazardous) : "--",
      caption: stats ? `su ${formatNumber(stats.total)} eventi` : "in attesa",
    },
    {
      label: "Passaggio piu' vicino",
      value:
        stats?.closest_miss_km != null ? `${formatKilometers(stats.closest_miss_km)} km` : "--",
      caption: "distanza minima nel range",
    },
    {
      label: "Diametro massimo",
      value:
        stats?.largest_diameter_km != null
          ? formatDiameterKm(stats.largest_diameter_km)
          : "--",
      caption: "massimo stimato NASA",
    },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" />
          <div>
            <div className="brand-name">ARKEMIS</div>
            <div className="brand-sub">NEO Observatory</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          {[
            ["overview", "Panoramica"],
            ["orbits", "Vista orbitale"],
            ["catalog", "Catalogo"],
            ["info", "Info"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={classNames("nav-button", section === value && "active")}
              onClick={() => goToSection(value as PageSection)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="status-pill">
            <span className="status-dot" />
            Proxy FastAPI
          </div>
          <div className="status-meta">
            Backend only, NASA never exposed to the browser.
          </div>
        </div>
      </aside>

      <main className="main-column">
        <header className="topbar">
          <div>
            <div className="eyebrow">
              NeoWs range {range.start} to {range.end}
            </div>
            <h1>
              Near Earth Objects, <em>resi leggibili</em>.
            </h1>
            <p className="lede">
              Dashboard full-stack con proxy FastAPI, cache chunked e una UI
              editoriale ispirata al mock Arkemis.
            </p>
          </div>
          <button
            className="theme-toggle"
            data-mode={theme}
            onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            aria-label={`Attiva modalita' ${theme === "dark" ? "light" : "dark"}`}
            aria-pressed={theme === "dark"}
          >
            <span className="theme-toggle-track" aria-hidden="true">
              <span className="theme-toggle-knob" />
            </span>
            <span className="theme-toggle-copy">
              <span>Dark mode</span>
              <strong>{theme === "dark" ? "On" : "Off"}</strong>
            </span>
          </button>
        </header>

        <section className="filters-bar">
          <label>
            <span>Da</span>
            <input
              type="date"
              value={range.start}
              onChange={(event) => setRange((current) => ({ ...current, start: event.target.value }))}
            />
          </label>
          <label>
            <span>A</span>
            <input
              type="date"
              value={range.end}
              onChange={(event) => setRange((current) => ({ ...current, end: event.target.value }))}
            />
          </label>
          <label>
            <span>Filtro</span>
            <select value={hazardFilter} onChange={(event) => setHazardFilter(event.target.value as HazardFilter)}>
              {HAZARD_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Ordina</span>
            <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="filters-meta">
            {feed?.meta.chunk_count ? `${feed.meta.chunk_count} chunk` : "nessun dato"}
          </div>
        </section>

        {errorMessage ? (
          <StateCard
            title="Richiesta non riuscita"
            description={errorMessage}
            emphasis="error"
          />
        ) : !feed ? (
          <DashboardSkeleton />
        ) : (
          <>
            <section className="content-section overview-grid" id="section-overview">
              <div className="section-kicker">
                <span>Panoramica</span>
                <strong>{visibleItems.length} eventi nel range filtrato</strong>
              </div>
              <div className="kpi-row">
                {summaryCards.map((card) => (
                  <article className="stat-card" key={card.label}>
                    <div className="stat-label">{card.label}</div>
                    <div className="stat-value">{card.value}</div>
                    <div className="stat-caption">{card.caption}</div>
                  </article>
                ))}
              </div>
              <article className="panel orbit-classes-panel">
                <div className="panel-head">
                  <div>
                    <div className="eyebrow subtle">Classi orbitali</div>
                    <h2>Composizione del campione</h2>
                  </div>
                </div>
                <div className="orbit-class-list">
                  {orbitClassSummary.length ? (
                    orbitClassSummary.map(([orbitClass, count]) => (
                      <div className="orbit-class-row" key={orbitClass}>
                        <span>{orbitClass}</span>
                        <strong>{count}</strong>
                      </div>
                    ))
                  ) : (
                    <span className="muted-copy">Classi non disponibili nel range corrente.</span>
                  )}
                </div>
              </article>
            </section>

            <section className="content-section" id="section-orbits">
              <div className="section-heading">
                <div>
                  <div className="eyebrow subtle">Vista orbitale</div>
                  <h2>Sistema eliocentrico ricostruito</h2>
                </div>
                <span className="meta-chip">ECharts GL line3D</span>
              </div>
              <section className="hero-grid orbital-stage-grid">
                <div className="hero-panel">
                  <div className="panel-head">
                    <div>
                      <div className="eyebrow subtle">Orbital data</div>
                      <h2>Orbite e tracce di avvicinamento</h2>
                    </div>
                    <span className="meta-chip">AU scale</span>
                  </div>
                  <Orbital3DChart data={visibleItems} />
                </div>
                <div className="stats-column">
                  {orbitalStats.map((card) => (
                    <article className="stat-card" key={card.label}>
                      <div className="stat-label">{card.label}</div>
                      <div className="stat-value">{card.value}</div>
                      <div className="stat-caption">{card.caption}</div>
                    </article>
                  ))}
                  <article className="state-card orbital-note">
                    <h3>Modello visuale</h3>
                    <p>
                      Le ellissi chiuse compaiono solo quando NeoWs fornisce semi-asse ed
                      eccentricita'. Se quei campi mancano, il grafico non inventa un'orbita:
                      disegna una traccia tratteggiata vicino alla Terra nella data del close
                      approach.
                    </p>
                  </article>
                  <article className="orbit-legend-card">
                    <h3>Oggetti mostrati</h3>
                    <p>Colori e numeri coincidono con le etichette nel grafico. Click per aprire la scheda NASA.</p>
                    <div className="orbit-legend-list">
                      {highlightedOrbitItems.slice(0, 10).map((item, index) => (
                        <button
                          key={item.event_id}
                          className={classNames(
                            "orbit-legend-row",
                            item.is_potentially_hazardous_asteroid && "danger",
                          )}
                          onClick={() => openNeo(item)}
                        >
                          <span
                            className="orbit-swatch"
                            style={{ background: getOrbitPaletteColor(index) }}
                          />
                          <span>
                            <strong>#{index + 1} {item.name}</strong>
                            <small>
                              {getOrbitClassType(item)} · {formatKilometers(Number(item.close_approach.miss_distance.kilometers))} km
                            </small>
                          </span>
                          {item.is_potentially_hazardous_asteroid ? <em>PHA</em> : null}
                        </button>
                      ))}
                    </div>
                  </article>
                </div>
              </section>
            </section>

            <section className="content-section charts-grid" id="section-analysis">
                <article className="panel">
                  <div className="panel-head">
                    <div>
                      <div className="eyebrow subtle">Grafico 01</div>
                      <h2>Distanza nel tempo</h2>
                    </div>
                  </div>
                  <DistanceOverTimeChart data={visibleItems} />
                </article>
                <article className="panel">
                  <div className="panel-head">
                    <div>
                      <div className="eyebrow subtle">Grafico 02</div>
                      <h2>Distribuzione dimensioni</h2>
                    </div>
                  </div>
                  <SizeDistributionChart data={visibleItems} />
                </article>
            </section>

            <section className="content-section panel" id="section-catalog">
                <div className="panel-head">
                  <div>
                    <div className="eyebrow subtle">Catalogo NEO</div>
                    <h2>Lista eventi di close approach</h2>
                  </div>
                  <span className="meta-chip">{visibleItems.length} risultati</span>
                </div>
                {visibleItems.length === 0 ? (
                  <StateCard
                    title="Nessun avvicinamento nel range"
                    description="Prova ad allargare il periodo o spostarti su un intervallo differente."
                  />
                ) : (
                  <div className="table-shell">
                    <div className="table-head">
                      <span>Asteroide</span>
                      <span>Data</span>
                      <span>Distanza</span>
                      <span>Diametro</span>
                      <span>Velocita'</span>
                      <span>Rischio</span>
                    </div>
                    {visibleItems.map((item) => (
                      <button
                        key={item.event_id}
                        className="table-row"
                        onClick={() => openNeo(item)}
                      >
                        <span className="table-name">
                          {item.name}
                          <small>{getOrbitClassType(item)}</small>
                        </span>
                        <span>{formatShortDate(item.close_approach.close_approach_date)}</span>
                        <span>{formatKilometers(Number(item.close_approach.miss_distance.kilometers))} km</span>
                        <span>{formatDiameterKm(item.estimated_diameter.kilometers.estimated_diameter_max)}</span>
                        <span>{Number(item.close_approach.relative_velocity.kilometers_per_second).toFixed(2)} km/s</span>
                        <span>
                          <span
                            className={classNames(
                              "risk-pill",
                              item.is_potentially_hazardous_asteroid && "danger",
                            )}
                          >
                            {item.is_potentially_hazardous_asteroid ? "Pericoloso" : "Sicuro"}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
            </section>

            <section className="content-section settings-grid" id="section-info">
                <article className="panel">
                  <div className="panel-head">
                    <div>
                      <div className="eyebrow subtle">Proxy contract</div>
                      <h2>Endpoint backend</h2>
                    </div>
                  </div>
                  <pre className="code-block">{`GET  /api/feed?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
GET  /api/neo/{id}
GET  /api/health
GET  /metrics
POST /api/cache/invalidate`}</pre>
                </article>
                <article className="panel">
                  <div className="panel-head">
                    <div>
                      <div className="eyebrow subtle">Cache status</div>
                      <h2>Osservabilita' minima</h2>
                    </div>
                  </div>
                  {health ? (
                    <div className="key-value-list">
                      <div><span>Entries</span><strong>{health.cache.entries}</strong></div>
                      <div><span>Hit ratio</span><strong>{(health.cache.hit_ratio * 100).toFixed(1)}%</strong></div>
                      <div><span>Expired</span><strong>{health.cache.expired_entries}</strong></div>
                      <div><span>Rate limit remaining</span><strong>{health.upstream.last_rate_limit_remaining ?? "--"}</strong></div>
                    </div>
                  ) : (
                    <StateCard title="Health non disponibile" description="Il backend non ha ancora esposto metriche o non e' raggiungibile." />
                  )}
                </article>
                <article className="panel panel-full">
                  <div className="panel-head">
                    <div>
                      <div className="eyebrow subtle">Info</div>
                      <h2>API key, hosting e stati applicativi</h2>
                    </div>
                  </div>
                  <p className="settings-copy">
                    La chiave NASA vive soltanto nel backend tramite `NASA_API_KEY`.
                    GitHub Pages puo' ospitare solo il frontend statico: per la parte FastAPI
                    serve un backend separato, ad esempio Render, Railway o Fly.io. Loading,
                    rate limit e input non valido sono gestiti come stati della stessa dashboard.
                  </p>
                </article>
            </section>
          </>
        )}
      </main>

      {activeNeoId && standaloneNeoId && (
        <section className="standalone-detail">
          <DetailContent detail={detail} detailLoading={detailLoading} onClose={closeModal} standalone />
        </section>
      )}
      {activeNeoId && !standaloneNeoId && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <DetailContent detail={detail} detailLoading={detailLoading} onClose={closeModal} />
          </div>
        </div>
      )}
      {isPending && <div className="route-indicator">Aggiorno il dettaglio...</div>}
    </div>
  );
}

function DetailContent({
  detail,
  detailLoading,
  onClose,
  standalone = false,
}: {
  detail: NeoDetailResponse | null;
  detailLoading: boolean;
  onClose: () => void;
  standalone?: boolean;
}) {
  if (detailLoading || !detail) {
    return <DashboardSkeleton compact />;
  }

  const diameterMin = detail.estimated_diameter.kilometers.estimated_diameter_min;
  const diameterMax = detail.estimated_diameter.kilometers.estimated_diameter_max;
  const diameterRatio = Math.max(8, Math.min(100, diameterMax * 44));
  const historicalCount = detail.close_approach_data.filter(
    (entry) => entry.close_approach_date && getApproachStatus(entry.close_approach_date) === "passato",
  ).length;
  const predictedCount = detail.close_approach_data.length - historicalCount;

  return (
    <>
      <div className="panel-head">
        <div>
          <div className="eyebrow subtle">{detail.designation ?? detail.neo_reference_id}</div>
          <h2>{detail.name}</h2>
        </div>
        {!standalone && (
          <button className="ghost-button" onClick={onClose}>
            Chiudi
          </button>
        )}
      </div>
      <div className="detail-banner">
        <span className={classNames("risk-pill", detail.is_potentially_hazardous_asteroid && "danger")}>
          {detail.is_potentially_hazardous_asteroid
            ? "Potenzialmente pericoloso"
            : "Sotto monitoraggio"}
        </span>
        <Link href={detail.nasa_jpl_url} target="_blank" className="text-link">
          Apri scheda JPL
        </Link>
      </div>
      <div className="source-callout">
        <strong>Dati NASA NeoWs</strong>
        <span>
          Non sono dati mock: arrivano da `GET /api/neo/{detail.id}`, proxy FastAPI verso NASA.
          Gli incontri futuri sono previsioni orbitali pubblicate dalla NASA, non eventi inventati.
        </span>
      </div>
      <div className="detail-grid">
        <article className="detail-panel">
          <h3>Dimensioni stimate</h3>
          <p>
            Da {formatDiameterKm(diameterMin)} a{" "}
            {formatDiameterKm(diameterMax)}
          </p>
          <div className="diameter-visual" aria-hidden="true">
            <span style={{ width: `${diameterRatio}%` }} />
          </div>
          <div className="detail-facts">
            <div>
              <span>Magnitudine assoluta H</span>
              <strong>{detail.absolute_magnitude_h ?? "--"}</strong>
            </div>
            <div>
              <span>Sentry object</span>
              <strong>{detail.is_sentry_object ? "Si" : "No"}</strong>
            </div>
            <div>
              <span>Close approach nel record</span>
              <strong>{detail.close_approach_data.length}</strong>
            </div>
          </div>
        </article>
        <article className="detail-panel">
          <h3>Dati orbitali</h3>
          <div className="key-value-list">
            {Object.entries(detail.orbital_data).slice(0, 8).map(([key, value]) => (
              <div key={key}>
                <span>{formatOrbitalLabel(key)}</span>
                <strong>{formatOrbitalValue(key, value)}</strong>
              </div>
            ))}
          </div>
        </article>
      </div>
      <article className="panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow subtle">Passaggi NASA</div>
            <h2>Close approach: passati e previsti</h2>
            <p className="panel-copy">
              La NASA restituisce un catalogo temporale: include osservazioni storiche e
              incontri futuri previsti dal modello orbitale corrente.
            </p>
          </div>
          <span className="meta-chip">{historicalCount} passati · {predictedCount} previsti</span>
        </div>
        <div className="history-list">
          <div className="history-row history-head">
            <span>Data</span>
            <span>Distanza Terra</span>
            <span>Velocita'</span>
            <span>Corpo orbitato</span>
            <span>Tipo</span>
          </div>
          {detail.close_approach_data.map((entry, index) => (
            <div className="history-row" key={`${entry.close_approach_date}-${index}`}>
              <span>{formatDate(entry.close_approach_date)}</span>
              <span>{entry.miss_distance?.kilometers ? `${formatKilometers(Number(entry.miss_distance.kilometers))} km` : "--"}</span>
              <span>{entry.relative_velocity?.kilometers_per_second ? `${Number(entry.relative_velocity.kilometers_per_second).toFixed(2)} km/s` : "--"}</span>
              <span>{entry.orbiting_body ? `Rispetto a ${entry.orbiting_body}` : "--"}</span>
              <span>
                <span className={classNames("time-pill", getApproachStatus(entry.close_approach_date) === "previsto" && "future")}>
                  {getApproachStatus(entry.close_approach_date)}
                </span>
              </span>
            </div>
          ))}
        </div>
      </article>
      {standalone && (
        <div className="standalone-actions">
          <Link href="/" className="ghost-button">
            Torna alla dashboard
          </Link>
        </div>
      )}
    </>
  );
}

function StateCard({
  title,
  description,
  emphasis,
}: {
  title: string;
  description: string;
  emphasis?: "error";
}) {
  return (
    <article className={classNames("state-card", emphasis === "error" && "error")}>
      <h3>{title}</h3>
      <p>{description}</p>
    </article>
  );
}

function DashboardSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className={classNames("skeleton-grid", compact && "compact")}>
      <div className="skeleton-block tall" />
      <div className="skeleton-block" />
      <div className="skeleton-block" />
      {!compact && <div className="skeleton-block wide" />}
    </div>
  );
}
