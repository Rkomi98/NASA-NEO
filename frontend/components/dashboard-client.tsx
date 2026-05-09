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

export function DashboardClient({ standaloneNeoId }: DashboardClientProps) {
  const defaults = useMemo(getDefaultRange, []);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [section, setSection] = useState<Section>("dashboard");
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
            ["dashboard", "Dashboard"],
            ["catalog", "Catalogo"],
            ["timeline", "Timeline"],
            ["states", "Edge cases"],
            ["settings", "Settings"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={classNames("nav-button", section === value && "active")}
              onClick={() => setSection(value as Section)}
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
            onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? "NASA paper" : "Spazio"}
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
            {(section === "dashboard" || section === "timeline") && (
              <section className="hero-grid">
                <div className="hero-panel">
                  <div className="panel-head">
                    <div>
                      <div className="eyebrow subtle">Vista orbitale</div>
                      <h2>Approach cloud in 3D</h2>
                    </div>
                    <span className="meta-chip">ECharts GL</span>
                  </div>
                  <Orbital3DChart data={visibleItems} />
                </div>
                <div className="stats-column">
                  {summaryCards.map((card) => (
                    <article className="stat-card" key={card.label}>
                      <div className="stat-label">{card.label}</div>
                      <div className="stat-value">{card.value}</div>
                      <div className="stat-caption">{card.caption}</div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {(section === "dashboard" || section === "timeline") && (
              <section className="charts-grid">
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
            )}

            {(section === "dashboard" || section === "catalog") && (
              <section className="panel">
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
                          <small>{item.orbital_data.orbit_class ? String((item.orbital_data.orbit_class as { type?: string }).type ?? "") : ""}</small>
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
            )}

            {section === "states" && (
              <section className="states-grid">
                <StateCard
                  title="Skeleton loader"
                  description="Il caricamento del feed e del dettaglio mostra placeholder solidi invece di layout jump."
                />
                <StateCard
                  title="Rate limit NASA"
                  description="Se il backend riceve 429, il frontend mostra un messaggio chiaro senza mai colpire direttamente api.nasa.gov."
                  emphasis="error"
                />
                <StateCard
                  title="Input invalido"
                  description="Le date vengono validate prima delle chiamate upstream e tornano con HTTP 400 e copy leggibile."
                  emphasis="error"
                />
              </section>
            )}

            {section === "settings" && (
              <section className="settings-grid">
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
                      <div className="eyebrow subtle">Deployment note</div>
                      <h2>API key e hosting</h2>
                    </div>
                  </div>
                  <p className="settings-copy">
                    La chiave NASA vive soltanto nel backend tramite `NASA_API_KEY`.
                    GitHub Pages puo' ospitare solo il frontend statico: per la parte FastAPI
                    serve un backend separato, ad esempio Render, Railway o Fly.io.
                  </p>
                </article>
              </section>
            )}
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
      <div className="detail-grid">
        <article className="detail-panel">
          <h3>Dimensioni stimate</h3>
          <p>
            Da {formatDiameterKm(detail.estimated_diameter.kilometers.estimated_diameter_min)} a{" "}
            {formatDiameterKm(detail.estimated_diameter.kilometers.estimated_diameter_max)}
          </p>
        </article>
        <article className="detail-panel">
          <h3>Dati orbitali</h3>
          <div className="key-value-list">
            {Object.entries(detail.orbital_data).slice(0, 8).map(([key, value]) => (
              <div key={key}>
                <span>{key}</span>
                <strong>{typeof value === "object" ? JSON.stringify(value) : String(value)}</strong>
              </div>
            ))}
          </div>
        </article>
      </div>
      <article className="panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow subtle">Storico avvicinamenti</div>
            <h2>Close approach data</h2>
          </div>
        </div>
        <div className="history-list">
          {detail.close_approach_data.map((entry, index) => (
            <div className="history-row" key={`${entry.close_approach_date}-${index}`}>
              <span>{formatDate(entry.close_approach_date)}</span>
              <span>{entry.miss_distance?.kilometers ? `${formatKilometers(Number(entry.miss_distance.kilometers))} km` : "--"}</span>
              <span>{entry.relative_velocity?.kilometers_per_second ? `${Number(entry.relative_velocity.kilometers_per_second).toFixed(2)} km/s` : "--"}</span>
              <span>{entry.orbiting_body ?? "--"}</span>
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
