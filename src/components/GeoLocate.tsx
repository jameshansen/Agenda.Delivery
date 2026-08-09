"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

/**
 * Client component that detects the user's location via the browser
 * Geolocation API (with IP geolocation fallback via a public API), then
 * redirects to ?near=lat,lng so the server can filter by proximity.
 */
export default function GeoLocate({ label }: { label: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentNear = searchParams.get("near");

  function handleLocate() {
    setLoading(true);
    setError(null);

    if (!navigator.geolocation) {
      // Fallback to IP geolocation
      ipLocate();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        router.push(`/?near=${latitude.toFixed(4)},${longitude.toFixed(4)}`);
        setLoading(false);
      },
      () => {
        // Permission denied or error — fall back to IP
        ipLocate();
      },
      { timeout: 10000 },
    );
  }

  async function ipLocate() {
    try {
      const res = await fetch("https://ipapi.co/json/");
      if (res.ok) {
        const data = await res.json();
        if (data.latitude && data.longitude) {
          router.push(
            `/?near=${data.latitude.toFixed(4)},${data.longitude.toFixed(4)}`,
          );
          setLoading(false);
          return;
        }
      }
    } catch {
      // ignore
    }
    setError("Couldn't determine your location.");
    setLoading(false);
  }

  if (currentNear) {
    return (
      <button
        onClick={() => router.push("/")}
        className="rounded-lg border border-black/15 px-3 py-1.5 text-sm hover:border-green hover:text-green"
      >
        <i className="fa-solid fa-location-crosshairs mr-1.5" />
        showing nearby · reset
      </button>
    );
  }

  return (
    <button
      onClick={handleLocate}
      disabled={loading}
      className="rounded-lg border border-black/15 px-3 py-1.5 text-sm hover:border-green hover:text-green disabled:opacity-50"
    >
      <i
        className={`fa-solid fa-location-crosshairs mr-1.5 ${loading ? "animate-spin" : ""}`}
      />
      {loading ? "locating…" : error ?? label}
    </button>
  );
}