'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { deliveryAreas } from '@/lib/delivery-data';
import { useT } from '../use-t';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

// HIRFA (P4): artisan store application dialog. On success the server
// creates (or re-opens) a PENDING ArtisanProfile; approval is admin-only
// via the privileged admin gate. The client sends the area SLUG and the
// server resolves it to the DeliveryArea row id.
export function ApplyArtisanDialog({
  onClose,
}: {
  onClose: () => void;
}) {
  const { t, isAr } = useT();
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [phone, setPhone] = useState('');
  const [areaSlug, setAreaSlug] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const name = displayName.trim();
    if (name.length < 2) {
      toast.error(t.storeNameRequired);
      return;
    }
    setSubmitting(true);
    try {
      await api.applyArtisan({
        displayName: name,
        bio: bio.trim() || undefined,
        phone: phone.trim() || undefined,
        areaSlug: areaSlug || undefined,
      });
      toast.success(t.craftApplicationPending);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'alreadyApplied') {
        toast.info(t.craftApplicationPending);
      } else if (msg === 'invalidPhone') {
        toast.error(isAr ? 'رقم الهاتف غير صحيح' : 'Numéro de téléphone invalide');
      } else if (msg === 'invalidArea') {
        toast.error(isAr ? 'الحي غير صحيح' : 'Quartier invalide');
      } else {
        toast.error(isAr ? 'تعذر إرسال الطلب' : 'Impossible d’envoyer la demande');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" dir={isAr ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle>{t.applyAsArtisan}</DialogTitle>
          <DialogDescription>{t.openCraftStoreSub}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-foreground">{t.storeName}</label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} placeholder={isAr ? 'مثال: خياطة أم نورة' : 'Ex : Couture Oum Noura'} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-foreground">{t.storeBio}</label>
            <Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={500} placeholder={isAr ? 'اكتب وصفاً قصيراً عن منتجاتك...' : 'Décrivez brièvement vos produits...'} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-foreground">{t.phoneHint}</label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" inputMode="tel" placeholder="05XX XX XX XX" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-foreground">{t.storeArea}</label>
            <Select value={areaSlug} onValueChange={setAreaSlug}>
              <SelectTrigger className="w-full"><SelectValue placeholder={t.chooseArea} /></SelectTrigger>
              <SelectContent>
                {deliveryAreas.map(([nameAr, nameFr, slug]) => (
                  <SelectItem key={slug} value={slug}>{isAr ? nameAr : nameFr || nameAr}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleSubmit} disabled={submitting} className="h-12 w-full rounded-xl bg-emerald-600 text-sm font-black text-white hover:bg-emerald-700">
            {submitting && <Loader2 size={16} className="me-1 animate-spin" />}
            {t.submitApplication}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
