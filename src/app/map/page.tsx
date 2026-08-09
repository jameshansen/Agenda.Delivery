import Link from "next/link";
import { getModules } from "@/db/queries";

export const dynamic = "force-dynamic";

/**
 * Coverage map — renders pins dynamically from each module's actual lat/lng
 * coordinates (set by the geo.locate agent). Modules without coordinates are
 * listed but not pinned.
 *
 * The map uses a simple equirectangular projection (lat/lng -> %x/%y) over
 * a styled placeholder. This is intentionally lightweight — no external map
 * tile library — while still being driven by real data. An interactive
 * Leaflet/OSM layer can replace the background later without changing the
 * pin logic.
 */

// North America bounding box for the projection
const BBOX = { minLng: -168, maxLng: -52, minLat: 25, maxLat: 72 };

/** Project lat/lng to x/y percentages within the bounding box. */
function project(lat: number, lng: number): { top: string; left: string } {
  const x = ((lng - BBOX.minLng) / (BBOX.maxLng - BBOX.minLng)) * 100;
  // Invert lat because screen y goes down
  const y = (1 - (lat - BBOX.minLat) / (BBOX.maxLat - BBOX.minLat)) * 100;
  return {
    left: `${Math.max(0, Math.min(100, x))}%`,
    top: `${Math.max(0, Math.min(100, y))}%`,
  };
}

export default async function MapPage() {
  const liveModules = await getModules();
  const pinned = liveModules.filter((m) => m.lat != null && m.lng != null);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
        <h1 className="text-3xl sm:text-4xl">Coverage map</h1>
        <p className="mt-1 text-ink-soft">
          Every module places itself on the map. The spider is steadily filling
          in Canada, then the United States.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            [String(liveModules.length), "councils monitored"],
            [String(new Set(liveModules.map((m) => m.province)).size), "provinces live"],
            ["—", "agendas tracked"],
            [String(pinned.length), "geolocated"],
          ].map(([v, l]) => (
            <div key={l} className="rounded-xl border border-black/5 bg-white/50 p-4">
              <div className="text-2xl font-semibold tabular-nums">{v}</div>
              <div className="text-xs text-ink-soft">{l}</div>
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          {/* Map panel */}
          <div className="lg:col-span-2">
            <div
              className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl border border-black/10 bg-row/40"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 1px 1px, rgba(0,0,0,0.06) 1px, transparent 0)",
                backgroundSize: "22px 22px",
              }}
            >
              {pinned.length === 0 && (
                <span className="absolute bottom-3 right-3 rounded bg-paper/80 px-2 py-1 text-[10px] text-ink-soft">
                  no geolocated modules yet — run the spider to populate the map
                </span>
              )}
              {pinned.map((m) => {
                const { top, left } = project(m.lat!, m.lng!);
                return (
                  <Link
                    key={m.slug}
                    href={`/module/${m.slug}`}
                    className="group absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ top, left }}
                  >
                    <span className={`block h-3 w-3 rounded-full ring-4 ${
                      m.health === "healthy"
                        ? "bg-green ring-green/20"
                        : m.health === "repairing"
                          ? "bg-amber-500 ring-amber-500/20"
                          : "bg-rose-500 ring-rose-500/20"
                    }`} />
                    <span className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-[10px] text-paper opacity-0 transition-opacity group-hover:opacity-100">
                      {m.name}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Monitored list */}
          <div>
            <h2 className="text-lg">Live modules</h2>
            <ul className="mt-3 space-y-2">
              {liveModules.map((m) => (
                <li key={m.slug}>
                  <Link
                    href={`/module/${m.slug}`}
                    className="flex items-center justify-between rounded-lg bg-row px-4 py-3 hover:bg-row-hover"
                  >
                    <span>
                      <span className="block font-medium">{m.name}</span>
                      <span className="block text-xs text-ink-soft">
                        {m.region}
                      </span>
                    </span>
                    <span className="text-xs text-ink-soft">
                      {m.health === "healthy"
                        ? "healthy"
                        : m.health === "repairing"
                          ? "repairing"
                          : "broken"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
    </main>
  );
}