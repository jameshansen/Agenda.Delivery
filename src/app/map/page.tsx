import Link from "next/link";
import { getModules } from "@/db/queries";

export const dynamic = "force-dynamic";

// ponytail: styled placeholder map. Real interactive tiles (Leaflet + OSM,
// driven by the geo.locate agent's lat/lng) land with the geodata in Phase 4-5.
const PINS = [
  { name: "Township of Langley", slug: "township-of-langley", top: "58%", left: "16%" },
  { name: "City of Langley", slug: "city-of-langley", top: "61%", left: "18%" },
  { name: "City of Surrey", top: "56%", left: "14%" },
  { name: "District of Saanich", top: "70%", left: "8%" },
  { name: "City of Kelowna", top: "48%", left: "34%" },
  { name: "City of Calgary", top: "44%", left: "58%" },
  { name: "City of Winnipeg", top: "52%", left: "74%" },
  { name: "City of Guelph", top: "60%", left: "88%" },
];

export default async function MapPage() {
  const liveModules = await getModules();
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
        <h1 className="text-3xl sm:text-4xl">Coverage map</h1>
        <p className="mt-1 text-ink-soft">
          Every module places itself on the map. The spider is steadily filling
          in Canada, then the United States.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            ["214", "councils monitored"],
            ["3", "provinces live"],
            ["11,904", "agendas tracked"],
            ["19", "found this week"],
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
              {PINS.map((p) => {
                const pin = (
                  <span className="group absolute -translate-x-1/2 -translate-y-1/2" style={{ top: p.top, left: p.left }}>
                    <span className="block h-3 w-3 rounded-full bg-green ring-4 ring-green/20" />
                    <span className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-[10px] text-paper opacity-0 transition-opacity group-hover:opacity-100">
                      {p.name}
                    </span>
                  </span>
                );
                return "slug" in p ? (
                  <Link key={p.name} href={`/module/${p.slug}`}>
                    {pin}
                  </Link>
                ) : (
                  <span key={p.name}>{pin}</span>
                );
              })}
              <span className="absolute bottom-3 right-3 rounded bg-paper/80 px-2 py-1 text-[10px] text-ink-soft">
                interactive tiles coming in Phase 4
              </span>
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
                      {m.health === "healthy" ? "healthy" : "self-repaired"}
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
