import Link from "next/link";
import { getModules } from "@/db/queries";
import CoverageMap from "@/components/CoverageMap";

export const dynamic = "force-dynamic";

/**
 * Coverage map — renders pins from each module's actual lat/lng coordinates
 * (set by the geo.locate agent) on a real Leaflet/OpenStreetMap tile map.
 * Modules without coordinates are listed but not pinned.
 */

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
            [String(liveModules.length), "agendas monitored"],
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
            {pinned.length === 0 ? (
              <div className="flex aspect-[16/10] w-full items-center justify-center rounded-2xl border border-black/10 bg-row/40 text-sm text-ink-soft">
                no geolocated modules yet — run the spider to populate the map
              </div>
            ) : (
              <CoverageMap
                pins={pinned.map((m) => ({
                  slug: m.slug,
                  name: m.name,
                  health: m.health,
                  lat: m.lat!,
                  lng: m.lng!,
                }))}
              />
            )}
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