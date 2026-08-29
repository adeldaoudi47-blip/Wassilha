"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  Package, MapPin, Flag, Navigation, Bike, CheckCircle2, Phone,
  MessageCircle, PackageCheck, Star, AlertTriangle, Radio, Gauge,
  Crosshair,
} from "lucide-react";
import { useT } from "../use-t";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";
import { emitOrderStatus } from "@/lib/realtime";
import { ActiveTrip } from "./active-trip";
import { CargoIcon, StatusBadge } from "../cargo-icon";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDzd } from "@/lib/wassilha-data";
import type { Order, OrderStatus } from "@/lib/types";

// Leaflet touches `window` at module init, so the map is loaded only on the
// client. During SSR / first paint we render a small skeleton placeholder.
const LiveMap = dynamic(
  () => import("../live-map").then((m) => m.LiveMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-72 w-full items-center justify-center rounded-2xl border border-border bg-muted/40 text-xs text-muted-foreground">
        Loading map…
      </div>
    ),
  },
);

export function DriverTrips() {
  const { t, isAr } = useT();
  const user = useAppStore((s) => s.user);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.listOrders({ role: "driver" });
      setOrders(list);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const active = orders.find((o) => o.status === "accepted" || o.status === "picked");
  const past = orders.filter((o) => o.status === "delivered" || o.status === "cancelled");

  const statusLabel = (s: OrderStatus) =>
    (t as unknown as Record<string, string>)[
      s === "searching" ? "pending"
      : s === "accepted" ? "accepted"
      : s === "picked" ? "inTransit"
      : s === "delivered" ? "delivered"
      : "cancelled"
    ];

  const refresh = async (id: string) => {
    try {
      const updated = await api.getOrder(id);
      setOrders((prev) => prev.map((o) => (o.id === id ? updated : o)));
    } catch { /* ignore */ }
  };

  const handlePickup = async (order: Order) => {
    setActing(order.id);
    try {
      const updated = await api.pickupOrder(order.id);
      emitOrderStatus(updated);
      toast.success(isAr ? "تم استلام الحمولة" : "Cargaison ramassée");
      await refresh(order.id);
    } catch {
      toast.error(isAr ? "فشل" : "Échec");
    } finally {
      setActing(null);
    }
  };

  const handleDeliver = async (order: Order) => {
    setActing(order.id);
    try {
      const updated = await api.deliverOrder(order.id);
      emitOrderStatus(updated);
      toast.success(isAr ? "تم التوصيل! 🎉" : "Livré! 🎉");
      await refresh(order.id);
    } catch {
      toast.error(isAr ? "فشل" : "Échec");
    } finally {
      setActing(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="px-1 text-lg font-black text-foreground">{t.myTrips}</h2>

      {active ? (
        <ActiveTrip
          active={active}
          driverId={user?.id ?? null}
          statusLabel={statusLabel}
          onPickup={() => handlePickup(active)}
          onDeliver={() => handleDeliver(active)}
          acting={acting === active.id}
        />
      ) : (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Bike size={24} className="text-muted-foreground" />
          </div>
          <p className="text-sm font-semibold text-muted-foreground">{t.noTrips}</p>
        </Card>
      )}

      {past.length > 0 && (
        <div>
          <h3 className="mb-2 px-1 text-xs font-bold text-muted-foreground">
            {isAr ? "الرحلات السابقة" : "Courses passées"}
          </h3>
          <div className="space-y-2">
            {past.map((o) => (
              <Card key={o.id} className="p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                    <CargoIcon cargo={o.cargoType} size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold">{o.code}</span>
                      <StatusBadge status={o.status} label={statusLabel(o.status)} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {o.pickup} → {o.dropoff}
                    </p>
                    {o.rating && (
                      <p className="mt-0.5 flex items-center gap-0.5 text-[11px] font-semibold text-amber-500">
                        <Star size={10} fill="currentColor" /> {o.rating}
                      </p>
                    )}
                  </div>
                  <div className="text-end">
                    <p className="text-sm font-black text-primary">{formatDzd(o.price)}</p>
                    <p className="text-[10px] text-muted-foreground">{t.dzd}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
