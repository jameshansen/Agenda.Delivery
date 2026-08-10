"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { Health } from "@/db/queries";

const HEALTH_COLOR: Record<Health, string> = {
  healthy: "#10b981",
  repairing: "#f59e0b",
  broken: "#f43f5e",
};

export default function CoverageMap({
  pins,
}: {
  pins: { slug: string; name: string; health: Health; lat: number; lng: number }[];
}) {
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!elRef.current) return;
    let map: import("leaflet").Map | undefined;
    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled || !elRef.current) return;
      map = L.map(elRef.current, { scrollWheelZoom: false }).setView([49, -95], 3);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18,
      }).addTo(map);

      for (const p of pins) {
        L.circleMarker([p.lat, p.lng], {
          radius: 6,
          color: HEALTH_COLOR[p.health],
          fillColor: HEALTH_COLOR[p.health],
          fillOpacity: 0.85,
          weight: 2,
        })
          .addTo(map)
          .bindPopup(`<a href="/module/${p.slug}">${p.name}</a>`);
      }
    });

    return () => {
      cancelled = true;
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={elRef}
      className="aspect-[16/10] w-full overflow-hidden rounded-2xl border border-black/10"
    />
  );
}
