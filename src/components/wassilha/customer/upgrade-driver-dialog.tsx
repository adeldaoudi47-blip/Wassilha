'use client';

import { useState } from 'react';
import { X, Bike, ShieldCheck, AlertCircle, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useT } from '../use-t';
import { api } from '@/lib/api';
import { toast } from 'sonner';

interface UpgradeDriverDialogProps {
  isAr: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

// Compact "lite" version of the driver form used on the customer profile
// screen. It only collects the strictly required carte-grise fields; the
// server re-validates everything so this form is best-effort UX.
export function UpgradeDriverDialog({ isAr, onClose, onSuccess }: UpgradeDriverDialogProps) {
  // `t` is the i18n bag so the new "Service proposé" select can render
  // its labels from the same dictionary as the rest of the app, instead
  // of duplicating the AR/FR strings inline (the dialog already passed
  // `isAr` in for older strings, but we now need the translation
  // function for the new driverService / cargoService / taxiService /
  // bothServices keys).
  const { t } = useT();
  const [name, setName] = useState('');
  const [numeroImmatriculation, setNumeroImmatriculation] = useState('');
  const [typeProprietaire, setTypeProprietaire] = useState<'PERSONNE_PHYSIQUE' | 'PERSONNE_MORALE'>('PERSONNE_PHYSIQUE');
  const [nom, setNom] = useState('');
  const [prenom, setPrenom] = useState('');
  const [raisonSociale, setRaisonSociale] = useState('');
  const [marque, setMarque] = useState('');
  const [datePremiereMiseEnCirculation, setDate] = useState('');
  const [adresse, setAdresse] = useState('');
  // Cargo capacity in kg. Required for CARGO / BOTH, hidden for TAXI.
  // Free-form string (matches the rest of the carte-grise optional
  // fields) so the driver can enter "500", "1.5t", etc.
  const [cargoCapacity, setCargoCapacity] = useState('');
  // Number of passenger seats. Required for TAXI / BOTH, hidden for
  // CARGO. Kept as a string so the form can be partially filled without
  // losing the user's input; the submit handler converts and validates.
  const [seats, setSeats] = useState('');
  // `serviceType` is sent to the server alongside the rest of the
  // carte-grise data and persisted in `Driver.serviceType`. Once
  // approved, the driver will only receive orders matching this
  // service category (cargo / taxi / both). Defaults to "CARGO" so
  // existing flows keep working without forcing the user to pick.
  const [serviceType, setServiceType] = useState<'CARGO' | 'TAXI' | 'BOTH'>('CARGO');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (name.trim().length < 2) {
      toast.error(isAr ? 'أدخل الاسم الكامل' : 'Entrez votre nom complet');
      return;
    }
    if (!numeroImmatriculation.trim()) {
      toast.error(isAr ? 'أدخل رقم التسجيل' : "Entrez le numéro d’immatriculation");
      return;
    }
    if (typeProprietaire === 'PERSONNE_PHYSIQUE') {
      if (!nom.trim() || !prenom.trim()) {
        toast.error(isAr ? 'أدخل اسم ولقب المالك' : 'Entrez le nom et le prénom du propriétaire');
        return;
      }
    } else if (!raisonSociale.trim()) {
      toast.error(isAr ? 'أدخل اسم الشركة' : 'Entrez la raison sociale');
      return;
    }
    if (!marque.trim() || !datePremiereMiseEnCirculation.trim() || !adresse.trim()) {
      toast.error(isAr ? 'أكمل باقي الحقول المطلوبة' : 'Renseignez les autres champs obligatoires');
      return;
    }
    const year = new Date(datePremiereMiseEnCirculation).getFullYear();
    const currentYear = new Date().getFullYear();
    if (!Number.isFinite(year) || year < 1950 || year > currentYear + 1) {
      toast.error(isAr ? 'تاريخ غير صحيح' : 'Date invalide');
      return;
    }
    // Conditional validation matching the service type: cargo needs
    // capacity, taxi needs seats. BOTH needs both.
    if (serviceType !== 'TAXI') {
      if (!cargoCapacity.trim()) {
        toast.error(isAr ? 'أدخل الحمولة الإجمالية' : 'Entrez la capacite de chargement');
        return;
      }
    }
    if (serviceType !== 'CARGO') {
      const seatsN = parseInt(seats, 10);
      if (!Number.isFinite(seatsN) || seatsN < 1 || seatsN > 30) {
        toast.error(isAr ? 'أدخل عدد مقاعد صحيح بين 1 و 30' : 'Entrez un nombre de places valide (1 a 30)');
        return;
      }
    }
    setLoading(true);
    try {
      await api.applyDriver({
        name: name.trim(),
        numeroImmatriculation: numeroImmatriculation.trim(),
        typeProprietaire,
        nom: typeProprietaire === 'PERSONNE_PHYSIQUE' ? nom.trim() : undefined,
        prenom: typeProprietaire === 'PERSONNE_PHYSIQUE' ? prenom.trim() : undefined,
        raisonSociale: typeProprietaire === 'PERSONNE_MORALE' ? raisonSociale.trim() : undefined,
        marque: marque.trim(),
        anneePremiereMiseCirculation: year,
        datePremiereMiseEnCirculation: datePremiereMiseEnCirculation.trim(),
        adresse: adresse.trim(),
        // Cargo capacity (optional, required for CARGO / BOTH). Sent as
        // `ptac` to keep the wire field aligned with the carte-grise
        // semantics already in place.
        ptac: cargoCapacity.trim() || undefined,
        // Passenger seats. Required for TAXI / BOTH, ignored for CARGO.
        seats: serviceType === 'CARGO' ? undefined : (parseInt(seats, 10) || undefined),
        // Persisted in Driver.serviceType and used by the order fan-out
        // in POST /api/orders to filter which drivers get the push.
        serviceType,
      });
      toast.success(
        isAr
          ? 'تم إرسال طلبك. سيُراجَع من طرف المدير وستحتاج لتسجيل الدخول من جديد بعد الموافقة.'
          : 'Demande envoyée. Elle sera examinée par l’administrateur ; vous devrez vous reconnecter après approbation.'
      );
      // Server set requiresReauth = true because we revoke all sessions;
      // propagate that to the parent which clears the local user and the
      // app falls through to the auth flow.
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      toast.error(
        isAr
          ? `فشل إرسال الطلب: ${msg || 'خطأ غير معروف'}`
          : `Échec de l’envoi : ${msg || 'erreur inconnue'}`
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl bg-background p-5 shadow-2xl sm:rounded-3xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Bike size={18} />
            </div>
            <div>
              <p className="text-sm font-black text-foreground">
                {isAr ? 'طلب الترقية لسائق' : 'Postuler comme chauffeur'}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {isAr ? 'سيُحفظ رقم هاتفك الحالي على الطلب' : 'Votre numéro actuel sera utilisé'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground"
            aria-label={isAr ? 'إغلاق' : 'Fermer'}
          >
            <X size={18} />
          </button>
        </div>

        <div className="mb-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-[11px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <p>
            {isAr
              ? 'سيتم تسجيل خروجك تلقائياً بعد الإرسال. بعد موافقة المدير، سجّل الدخول من جديد برقمك لتفعيل حساب السائق.'
              : 'Vous serez déconnecté après l’envoi. Reconnectez-vous avec votre numéro après approbation pour activer le compte chauffeur.'}
          </p>
        </div>

        <div className="space-y-3">
          <Field label={isAr ? 'الاسم الكامل' : 'Nom complet'} required>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-11 rounded-xl" />
          </Field>
          <Field label={isAr ? 'رقم التسجيل' : "Numéro d’immatriculation"} required>
            <Input
              value={numeroImmatriculation}
              onChange={(e) => setNumeroImmatriculation(e.target.value)}
              className="h-11 rounded-xl"
              dir="ltr"
            />
          </Field>
          <Field label={isAr ? 'نوع المالك' : 'Type de propriétaire'} required>
            <Select
              value={typeProprietaire}
              onValueChange={(v) => setTypeProprietaire(v as 'PERSONNE_PHYSIQUE' | 'PERSONNE_MORALE')}
            >
              <SelectTrigger className="h-11 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PERSONNE_PHYSIQUE">{isAr ? 'شخص طبيعي' : 'Personne physique'}</SelectItem>
                <SelectItem value="PERSONNE_MORALE">{isAr ? 'شخص معنوي' : 'Personne morale'}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {typeProprietaire === 'PERSONNE_PHYSIQUE' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label={isAr ? 'اللقب' : 'Nom'} required>
                <Input value={nom} onChange={(e) => setNom(e.target.value)} className="h-11 rounded-xl" />
              </Field>
              <Field label={isAr ? 'الاسم' : 'Prénom'} required>
                <Input value={prenom} onChange={(e) => setPrenom(e.target.value)} className="h-11 rounded-xl" />
              </Field>
            </div>
          ) : (
            <Field label={isAr ? 'اسم الشركة' : 'Raison sociale'} required>
              <Input
                value={raisonSociale}
                onChange={(e) => setRaisonSociale(e.target.value)}
                className="h-11 rounded-xl"
              />
            </Field>
          )}
          <Field label={isAr ? 'ماركة المركبة' : 'Marque'} required>
            <Input value={marque} onChange={(e) => setMarque(e.target.value)} className="h-11 rounded-xl" />
          </Field>
          <Field
            label={isAr ? 'تاريخ أول وضع للسير' : 'Date de 1ère mise en circulation'}
            required
          >
            <Input
              type="date"
              value={datePremiereMiseEnCirculation}
              onChange={(e) => setDate(e.target.value)}
              className="h-11 rounded-xl"
              dir="ltr"
            />
          </Field>
          <Field label={isAr ? 'عنوان المالك' : 'Adresse du propriétaire'} required>
            <Input value={adresse} onChange={(e) => setAdresse(e.target.value)} className="h-11 rounded-xl" />
          </Field>
          {/* Driver service type — must be picked before the upgrade is
              accepted. Tells the order fan-out which drivers are eligible
              for the order (cargo / taxi / both). The conditional
              cargoCapacity/seats fields that follow read this value. */}
          <Field label={t.driverService} required>
            <Select
              value={serviceType}
              onValueChange={(v) => setServiceType(v as 'CARGO' | 'TAXI' | 'BOTH')}
            >
              <SelectTrigger className="h-11 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CARGO">{t.cargoService}</SelectItem>
                <SelectItem value="TAXI">{t.taxiService}</SelectItem>
                <SelectItem value="BOTH">{t.bothServices}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {serviceType !== 'TAXI' ? (
            <Field label={t.cargoCapacity} required>
              <Input
                value={cargoCapacity}
                onChange={(e) => setCargoCapacity(e.target.value)}
                placeholder={isAr ? 'الحمولة الإجمالية بالكيلوغرام' : 'Capacite de chargement (kg)'}
                className="h-11 rounded-xl"
                dir="ltr"
              />
            </Field>
          ) : null}
          {serviceType !== 'CARGO' ? (
            <Field label={t.seatsNumber} required>
              <Input
                type="number"
                min={1}
                max={30}
                value={seats}
                onChange={(e) => setSeats(e.target.value)}
                placeholder={isAr ? 'عدد المقاعد (1-30)' : 'Nombre de places (1-30)'}
                className="h-11 rounded-xl"
                dir="ltr"
              />
            </Field>
          ) : null}
        </div>

        <Button
          onClick={submit}
          disabled={loading}
          size="lg"
          className="mt-5 h-12 w-full rounded-xl bg-primary text-sm font-bold shadow-lg"
        >
          {loading ? <ShieldCheck className="animate-spin" size={18} /> : <ChevronRight size={18} />}
          {isAr ? 'إرسال الطلب' : 'Envoyer la demande'}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-bold text-muted-foreground">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </label>
      {children}
    </div>
  );
}
