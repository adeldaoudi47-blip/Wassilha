'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Clock, MapPin, Flag, Package, Car, Users, Star,
  CircleCheck,
} from 'lucide-react';
import { useT } from '../use-t';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { useNavStore } from '@/lib/store';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDzd } from '@/lib/wassilha-data';
import type { TripOffer, TripOfferServiceType, CargoKey } from '@/lib/types';
import { ListSkeleton, Skeleton } from '../skeleton';

// TRIP OFFERS — customer-side tab.
//
// Two-step flow:
//   1. Customer taps "Book" on a card → onBook() calls
//      `api.bookTripOffer(id)` and on success sets the
//      resulting `order.id` as the active order in the
//      nav store, then routes the customer to the
//      "track" tab so they see the live trip status.
//   2. The card's local state is updated optimistically
//      (status -> 'booked') so a second tap is a no-op
//      even if the API call is in flight.
//
// Filter chips at the top let the customer narrow the
// listing by service type (TAXI / CARGO / all).
export function CustomerOffers() {
  const { t, isAr } = useT();
  const setCustomerTab = useNavStore((s) => s.setCustomerTab);
  const setActiveOrderId = useNavStore((s) => s.setActiveOrderId);
  const [filter, setFilter] = useState<TripOfferServiceType | 'all'>('all');
  const [offers, setOffers] = useState<TripOffer[] | null>(null);
  const [booking, setBooking] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.listTripOffers(
        filter === 'all' ? undefined : { serviceType: filter },
      );
      setOffers(list);
    } catch {
      toast.error(isAr ? 'فشل التحميل' : 'Erreur de chargement');
    }
  }, [filter, isAr]);

  useEffect(() => { load(); }, [load]);

  const onBook = async (offer: TripOffer) => {
    if (booking) return;
    if (!confirm(t.confirmBook)) return;
    setBooking(offer.id);
    try {
      const { order } = await api.bookTripOffer(offer.id);
      toast.success(isAr ? 'تم الحجز' : 'Réservation confirmée');
      setActiveOrderId(order.id);
      setCustomerTab('track');
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : (isAr ? 'فشل الحجز' : 'Échec de la réservation'),
      );
    } finally {
      setBooking(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* Filter chips */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {(['all', 'TAXI', 'CARGO'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-semibold transition',
              filter === f
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-muted-foreground hover:text-foreground',
            )}
          >
            {f === 'all'
              ? (isAr ? 'الكل' : 'Tous')
              : f === 'TAXI' ? 'TAXI' : (isAr ? 'بضائع' : 'Marchandises')}
          </button>
        ))}
      </div>

      {offers === null ? (
        <div className="space-y-2">
          <ListSkeleton count={3} />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : offers.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          {t.noOffers}
        </Card>
      ) : (
        offers.map((o) => (
          <CustomerOfferCard
            key={o.id}
            offer={o}
            onBook={onBook}
            booking={booking === o.id}
          />
        ))
      )}
    </div>
  );
}

function CustomerOfferCard({
  offer,
  onBook,
  booking,
}: {
  offer: TripOffer;
  onBook: (o: TripOffer) => void;
  booking: boolean;
}) {
  const { t, isAr } = useT();
  const isTaxi = offer.serviceType === 'TAXI';
  const date = new Date(offer.scheduledAt);
  const driver = offer.driver;

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {isTaxi ? <Car size={16} /> : <Package size={16} />}
          <span>
            {isTaxi ? 'TAXI' : (offer.cargoType as CargoKey)?.toUpperCase()}
          </span>
        </div>
        <span className="text-base font-bold text-primary">
          {formatDzd(offer.price)}
        </span>
      </div>

      {/* driver line */}
      {driver && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CircleCheck size={12} className="text-emerald-600" />
          <span className="font-semibold text-foreground">
            {driver.user.name}
          </span>
          {driver.rating > 0 && (
            <span className="flex items-center gap-0.5">
              <Star size={11} className="fill-yellow-500 text-yellow-500" />
              {driver.rating.toFixed(1)}
            </span>
          )}
          <span>· {driver.totalTrips} {isAr ? 'رحلة' : 'trajets'}</span>
        </div>
      )}

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

      <Button
        size="sm"
        className="w-full"
        disabled={booking}
        onClick={() => onBook(offer)}
      >
        {booking ? '...' : t.bookOffer}
      </Button>
    </Card>
  );
}

