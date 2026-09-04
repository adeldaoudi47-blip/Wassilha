'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, Car, Package } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useT } from '../use-t';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import type { TripOfferServiceType, CargoKey } from '@/lib/types';

const CARGO_OPTIONS: CargoKey[] = [
  'parcel', 'goods', 'shop', 'furniture', 'appliance',
  'construction', 'personal', 'other',
];

// TRIP OFFERS — modal form to publish a new offer.
//
// Fields:
//   - serviceType: TAXI | CARGO
//   - pickup, dropoff: free text (matches the customer order form)
//   - scheduledAt: datetime-local (the browser converts to ISO via
//     `new Date(...)`. We pad the resulting Date to a real Date
//     object before sending.)
//   - price: DZD integer
//   - seatsAvail: TAXI only, required when serviceType==='TAXI'
//   - cargoType: CARGO only, required when serviceType==='CARGO'
//
// We deliberately do not call /api/driver/profile to fetch the
// driver's `serviceType` (BOTH / CARGO / TAXI): the API route
// already enforces the constraint and returns 403 if the
// driver tries to publish a category they don't service. The
// form just optimistically renders both options.
export function CreateOfferDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t, isAr } = useT();
  const [serviceType, setServiceType] = useState<TripOfferServiceType>('TAXI');
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  // `datetime-local` needs "YYYY-MM-DDTHH:mm" (no timezone, no
  // seconds). We compute a sensible default: now + 1h, truncated
  // to the minute.
  const defaultDt = (() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setSeconds(0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();
  const [scheduledAt, setScheduledAt] = useState(defaultDt);
  const [price, setPrice] = useState<number | ''>('');
  const [seatsAvail, setSeatsAvail] = useState<number | ''>(4);
  const [cargoType, setCargoType] = useState<CargoKey>('parcel');
  const [submitting, setSubmitting] = useState(false);

  // Reset on close.
  useEffect(() => {
    if (!open) {
      setPickup(''); setDropoff('');
      setScheduledAt(defaultDt);
      setPrice(''); setSeatsAvail(4);
      setCargoType('parcel');
    }
  // We intentionally only want to reset when the modal closes;
  // the defaultDt closure is stable per open/close cycle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    if (submitting) return;
    if (!pickup || !dropoff || !price || Number(price) <= 0) {
      toast.error(isAr ? 'يرجى ملء كل الحقول' : 'Veuillez remplir tous les champs');
      return;
    }
    setSubmitting(true);
    try {
      await api.createTripOffer({
        serviceType,
        pickup,
        dropoff,
        scheduledAt: new Date(scheduledAt).toISOString(),
        price: Number(price),
        seatsAvail: serviceType === 'TAXI' ? Number(seatsAvail) : undefined,
        cargoType: serviceType === 'CARGO' ? cargoType : undefined,
      });
      toast.success(isAr ? 'تم نشر العرض' : 'Offre publiée');
      onCreated();
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : (isAr ? 'فشل النشر' : 'Échec de la publication'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock size={18} />
            {t.createOffer}
          </DialogTitle>
          <DialogDescription>
            {isAr
              ? 'انشر رحلة لاحقة ليتمكن الزبائن من حجزها'
              : 'Publiez un trajet à venir pour permettre aux clients de réserver'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* serviceType */}
          <div>
            <Label>{isAr ? 'نوع الخدمة' : 'Type de service'}</Label>
            <Select value={serviceType} onValueChange={(v) => setServiceType(v as TripOfferServiceType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TAXI">
                  <span className="flex items-center gap-1.5">
                    <Car size={14} /> {t.taxiService}
                  </span>
                </SelectItem>
                <SelectItem value="CARGO">
                  <span className="flex items-center gap-1.5">
                    <Package size={14} /> {t.cargoService}
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* pickup / dropoff */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <Label>{t.pickup}</Label>
              <Input value={pickup} onChange={(e) => setPickup(e.target.value)} />
            </div>
            <div>
              <Label>{t.dropoff}</Label>
              <Input value={dropoff} onChange={(e) => setDropoff(e.target.value)} />
            </div>
          </div>

          {/* scheduledAt */}
          <div>
            <Label>{t.scheduledAt}</Label>
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>

          {/* price + service-specific field */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>{t.offerPrice}</Label>
              <Input
                type="number"
                min={1}
                value={price}
                onChange={(e) =>
                  setPrice(e.target.value === '' ? '' : Number(e.target.value))
                }
              />
            </div>
            {serviceType === 'TAXI' ? (
              <div>
                <Label>{t.seatsAvail}</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={seatsAvail}
                  onChange={(e) =>
                    setSeatsAvail(e.target.value === '' ? '' : Number(e.target.value))
                  }
                />
              </div>
            ) : (
              <div>
                <Label>{t.offerCargo}</Label>
                <Select value={cargoType} onValueChange={(v) => setCargoType(v as CargoKey)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CARGO_OPTIONS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {t.cancel}
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? '...' : t.createOffer}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

