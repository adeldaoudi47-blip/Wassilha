'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  CalendarClock, Trash2, Clock, MapPin, Flag, Package, Car, Users,
  CircleCheck, CircleX,
} from 'lucide-react';
import { useT } from '../use-t';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDzd } from '@/lib/wassilha-data';
import type { TripOffer, CargoKey } from '@/lib/types';
import { ListSkeleton, Skeleton } from '../skeleton';
import { CreateOfferDialog } from './create-offer-dialog';

// TRIP OFFERS — driver-side tab.
//
// Lists the driver's own offers (any status), and exposes a
// "create" button that opens a modal dialog. The driver can
// cancel a not-yet-booked offer. Booked offers are read-only
// (the customer holds the slot; cancellation must come from
// the customer cancelling their Order).
export function DriverOffers() {
  const { t, isAr } = useT();
  const [offers, setOffers] = useState<TripOffer[] | null>(null);
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.listMyTripOffers();
      setOffers(list);
    } catch {
      toast.error(isAr ? 'فشل تحميل العروض' : 'Erreur de chargement');
    }
  }, [isAr]);

  useEffect(() => { load(); }, [load]);

  const onCancel = async (id: string) => {
    if (cancelling) return;
    setCancelling(id);
    try {
      await api.cancelTripOffer(id);
      toast.success(isAr ? 'تم إلغاء العرض' : t.offerCancelled);
      // Reload the list to reflect the soft delete.
      await load();
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : (isAr ? 'تعذّر الإلغاء' : 'Annulation impossible'),
      );
    } finally {
      setCancelling(null);
    }
  };

  if (offers === null) {
    return (
      <div className="space-y-2">
        <ListSkeleton count={3} />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {isAr
            ? 'انشر رحلاتك المسبقة ليتمكن الزبائن من حجزها'
            : 'Publiez vos trajets à l\'avance pour permettre aux clients de réserver'}
        </p>
        <Button size="sm" onClick={() => setOpen(true)}>
          <CalendarClock size={16} className="ms-1" />
          {t.createOffer}
        </Button>
      </div>

      {offers.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          {t.noOffers}
        </Card>
      ) : (
        offers.map((o) => (
          <DriverOfferCard
            key={o.id}
            offer={o}
            onCancel={onCancel}
            cancelling={cancelling === o.id}
          />
        ))
      )}

      <CreateOfferDialog
        open={open}
        onClose={() => setOpen(false)}
        onCreated={async () => { setOpen(false); await load(); }}
      />
    </div>
  );
}

function DriverOfferCard({
  offer,
  onCancel,
  cancelling,
}: {
  offer: TripOffer;
  onCancel: (id: string) => void;
  cancelling: boolean;
}) {
  const { t, isAr } = useT();
  const isTaxi = offer.serviceType === 'TAXI';
  const date = new Date(offer.scheduledAt);

  // status pill: 'available' / 'booked' / 'cancelled'
  const pill =
    offer.status === 'available'
      ? { label: t.available, cls: 'bg-emerald-100 text-emerald-700' }
      : offer.status === 'booked'
      ? { label: t.booked, cls: 'bg-blue-100 text-blue-700' }
      : { label: t.offerCancelled, cls: 'bg-zinc-200 text-zinc-700' };

  return (
    <Card className={cn('p-3 space-y-2', offer.status === 'cancelled' && 'opacity-60')}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {isTaxi ? <Car size={16} /> : <Package size={16} />}
          <span>{isTaxi ? 'TAXI' : (offer.cargoType as CargoKey)?.toUpperCase()}</span>
          <span className={cn('ms-2 rounded-full px-2 py-0.5 text-[10px] font-bold', pill.cls)}>
            {pill.label}
          </span>
        </div>
        <span className="text-base font-bold text-primary">
          {formatDzd(offer.price)}
        </span>
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        <p className="flex items-center gap-1.5">
          <MapPin size={12} /> {offer.pickup}
        </p>
        <p className="flex items-center gap-1.5">
          <Flag size={12} /> {offer.dropoff}
        </p>
        <p className="flex items-center gap-1.5">
          <Clock size={12} />
          {date.toLocaleString(isAr ? 'ar-DZ' : 'fr-FR', {
            weekday: 'short', day: '2-digit', month: 'short',
            hour: '2-digit', minute: '2-digit',
          })}
        </p>
        {isTaxi && offer.seatsAvail !== null && (
          <p className="flex items-center gap-1.5">
            <Users size={12} /> {offer.seatsAvail} {t.offerSeats}
          </p>
        )}
      </div>

      {offer.status === 'available' && (
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          disabled={cancelling}
          onClick={() => onCancel(offer.id)}
        >
          {cancelling ? (
            <CircleX size={14} className="ms-1" />
          ) : (
            <Trash2 size={14} className="ms-1" />
          )}
          {t.cancelOffer}
        </Button>
      )}
      {offer.status === 'booked' && (
        <div className="flex items-center gap-1.5 text-xs text-blue-700">
          <CircleCheck size={14} />
          {t.offerBooked}
        </div>
      )}
    </Card>
  );
}
