'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type DriverLocationError =
  | { code: "denied"; message: string }
  | { code: "unavailable"; message: string }
  | { code: "timeout"; message: string }
  | { code: "unsupported"; message: string }
  | { code: "http"; status: number; message: string };

export interface DriverFix {
  lat: number;
  lng: number;
  speed: number | null;
  accuracy: number | null;
  timestamp: number;
}

export interface UseDriverLocationOptions {
  enabled: boolean;
  orderId: string | null | undefined;
  minIntervalMs?: number;
  post?: (url: string, body: unknown) => Promise<Response>;
}

export interface UseDriverLocationResult {
  fix: DriverFix | null;
  error: DriverLocationError | null;
  loading: boolean;
  sentCount: number;
  retry: () => void;
}

const DEFAULT_INTERVAL_MS = 5000;

// (rest will be appended)
export function useDriverLocation(
  opts: UseDriverLocationOptions,
): UseDriverLocationResult {
  const {
    enabled,
    orderId,
    minIntervalMs = DEFAULT_INTERVAL_MS,
    post = (url, body) =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
  } = opts;

  const [fix, setFix] = useState<DriverFix | null>(null);
  const [error, setError] = useState<DriverLocationError | null>(null);
  const [loading, setLoading] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const [retryTick, setRetryTick] = useState(0);

  const lastSentAtRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);
  const watchIdRef = useRef<number | null>(null);

  const send = useCallback(
    (lat: number, lng: number, accuracy: number | null) => {
      if (!orderId) return;
      const now = Date.now();
      if (inFlightRef.current) return;
      if (now - lastSentAtRef.current < minIntervalMs) return;
      lastSentAtRef.current = now;
      inFlightRef.current = true;
      post("/api/driver/location", { lat, lng, accuracy, orderId })
        .then((r) => {
          if (!r.ok) {
            setError({ code: "http", status: r.status, message: `HTTP ${r.status}` });
          } else {
            setSentCount((c) => c + 1);
          }
        })
        .catch((e) => {
          setError({ code: "http", status: 0, message: String(e) });
        })
        .finally(() => {
          inFlightRef.current = false;
        });
    },
    [orderId, minIntervalMs, post],
  );

  const retry = useCallback(() => {
    setError(null);
    setRetryTick((t) => t + 1);
  }, []);
  useEffect(() => {
    if (!enabled) {
      setFix(null);
      setError(null);
      setLoading(false);
      return;
    }
    if (typeof window === "undefined") return;
    if (!("geolocation" in navigator)) {
      setError({
        code: "unsupported",
        message: "Geolocation API not available in this browser",
      });
      return;
    }
    setLoading(true);
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setLoading(false);
        const next: DriverFix = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speed: pos.coords.speed,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        };
        setFix(next);
        send(next.lat, next.lng, next.accuracy);
      },
      (err) => {
        setLoading(false);
        if (err.code === err.PERMISSION_DENIED) {
          setError({ code: "denied", message: err.message });
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setError({ code: "unavailable", message: err.message });
        } else if (err.code === err.TIMEOUT) {
          setError({ code: "timeout", message: err.message });
        } else {
          setError({ code: "unavailable", message: err.message });
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      },
    );
    watchIdRef.current = id;
    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [enabled, retryTick, send]);

  return { fix, error, loading, sentCount, retry };
}
