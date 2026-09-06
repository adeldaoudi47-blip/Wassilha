'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Phone,
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  Headphones,
  Bike,
  Package,
  Sparkles,
  Key,
  Lock,
} from 'lucide-react';
import { BrandLogo } from '../brand-logo';
import { LangToggle } from '../lang-toggle';
import { useT } from '../use-t';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { Role } from '@/lib/types';
import { normalizeAlgerianPhone } from '@/lib/phone';

type Step = 'onboarding' | 'phone' | 'otp' | 'signup' | 'login' | 'forgot-phone' | 'forgot-otp' | 'forgot-reset' | 'driver-form' | 'driver-pending' | 'driver-rejected';

// SECURITY (V?? — OTP bypass lock-down): the OTP length is now a
// hard-coded 6 digits. The previous 4-digit demo branch (controlled
// by NEXT_PUBLIC_OTP_DEMO_MODE) was removed along with the BYPASS_SMS
// escape hatch on the server. Production always uses a 6-digit code
// that is delivered exclusively through the configured SMS / WhatsApp
// provider — no value is ever echoed back to the client.
const OTP_LENGTH = 6;

// SECURITY: demo quick-login UI is rendered only when explicitly enabled
// for local development. Production builds never render it.
const ENABLE_DEMO_LOGIN =
  process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === 'true';

export function AuthFlow() {
  const { t, isAr } = useT();
  const setUser = useAppStore((s) => s.setUser);

  const [step, setStep] = useState<Step>('onboarding');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [forgotPhone, setForgotPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  // In-flight guard for OTP verification. Prevents double-submit where a
  // first call (e.g. from a fast double-tap or auto-confirm) succeeds and
  // deletes the code from the DB, and the second call then fails with
  // `codeNotFound` even though the user is actually logged in / routed
  // correctly. Set true at the start of handleVerify, false in finally.
  const [verifying, setVerifying] = useState(false);
  // Synchronous lock for handleVerify. Unlike the erifying state above,
  // useRef updates instantly and reads are immediately visible across
  // the same event loop - so even if React batches two click events
  // (fast double-tap, Enter key + onClick, etc.) the second call sees
  // erifyingRef.current === true and bails out *before* dispatching
  // the second verify-otp request that would otherwise fail with
  // codeNotFound because the server already consumed the OTP.
  const verifyingRef = useRef(false);
  const [resendTimer, setResendTimer] = useState(0);
  // When true, the user picked the "Driver" tab on the OTP screen and
  // should be routed to the driver form on a fresh account instead of
  // the customer signup. The phone screen no longer has a "Become a
  // driver" button — the choice is now made on the OTP screen.
  const [intendsDriver, setIntendsDriver] = useState(false);
  // Driver self-registration form fields (filled after OTP verification).
  // Carte grise (vehicle registration) data — replaces the legacy ad-hoc
  // vehicleType / vehicleColor / plate / license inputs.
  const [vehicleRegistration, setVehicleRegistration] = useState({
    numeroImmatriculation: '',
    typeProprietaire: 'PERSONNE_PHYSIQUE' as 'PERSONNE_PHYSIQUE' | 'PERSONNE_MORALE',
    nom: '',
    prenom: '',
    raisonSociale: '',
    marque: '',
    type: '',
    anneePremiereMiseCirculation: '',
    datePremiereMiseEnCirculation: '',
    adresse: '',
    ptac: '',
    // Number of passenger seats. Required for TAXI / BOTH, hidden for
    // CARGO. Stored as Int on VehicleRegistration.seats (see the
    // server validation in /api/auth/apply-driver). Empty string means
    // 'not yet entered' so the submit handler can detect and 400.
    seats: '',
    // Driver picks which service(s) they want to provide. Persisted
    // in `Driver.serviceType` and used by the order fan-out query in
    // `POST /api/orders` so a cargo-only driver never receives a
    // `taxi` ping (and vice-versa). Defaults to "CARGO" for full
    // backward compat with the pre-taxi fleet: every existing driver
    // continues to receive cargo orders exactly as before.
    serviceType: 'CARGO' as 'CARGO' | 'TAXI' | 'BOTH',
  });
  const updateVehicleRegistration = (
    field: keyof typeof vehicleRegistration,
    value: string
  ) => {
    setVehicleRegistration((prev) => ({ ...prev, [field]: value }));
  };

  const Arrow = isAr ? ArrowLeft : ArrowRight;

  useEffect(() => {
    api.pendingSignup()
      .then(({ pendingSignup, phone: verifiedPhone }) => {
        if (pendingSignup && verifiedPhone) {
          setPhone(verifiedPhone);
          setStep('signup');
          // DIAG: a previously-saved driver intent should never bleed
          // into a recovered customer signup. We no longer force-reset
          // intendsDriver here because:
          //   1) The flag is a *client UX* intent captured at button press,
          //      not a server-side state.
          //   2) handleVerify branches on `intendsDriver` *at the moment
          //      of OTP verification*, not on this mount-time restore.
          //   3) Resetting it here was the only place the flag could be
          //      silently cleared between two consecutive registrations,
          //      which is the exact scenario the driver flow hits.
          //
          // If a future product decision is to ALWAYS route recovered
          // pending signups to the customer flow, do that explicitly at
          // the call site (e.g. inside handleSendOtp), not here.
          console.log('[AUTH FLOW] pendingSignup restored for phone:', verifiedPhone, '(intendsDriver preserved:', intendsDriver, ')');
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (resendTimer <= 0) return;

    const id = setTimeout(
      () => setResendTimer((s) => s - 1),
      1000
    );

    return () => clearTimeout(id);
  }, [resendTimer]);

  // DIAG: log every step change so we can trace the auth flow end-to-end
  // and see exactly when/why the UI transitions to a particular step.
  useEffect(() => {
    console.log('[AUTH FLOW] step CHANGED to:', step, '| intendsDriver=', intendsDriver, '| otp.length=', otp.length);
  }, [step, intendsDriver]);

  const handleSendOtp = async () => {
    // FIX: explicit reset — entering the customer path must clear any
    // previous "intends driver" state so the post-OTP router can't send
    // a customer into the driver form by accident.
    setIntendsDriver(false);
    // SECURITY + UX: single normalizer shared with the API €” accepts local,
    // international (+213), 00213 forms, spaces/dashes/invisible marks.
    const clean = normalizeAlgerianPhone(phone);

    if (!clean) {
      toast.error(
        isAr
          ? 'أدخل رقم هاتف جزائري صحيح'
          : 'Entrez un numéro de téléphone algérien valide'
      );
      return;
    }

    setLoading(true);

    try {
      const result = await api.sendOtp(clean);

      setPhone(clean);
      setOtp('');
      setStep('otp');
      setResendTimer(30);

      // SECURITY (V?? — OTP bypass lock-down): the server no longer
      // returns the OTP in the response (BYPASS_SMS has been removed
      // from /api/auth/send-otp). The only user-facing message is
      // "we sent the code" — never the code itself.
      toast.success(
        isAr
          ? 'تم إرسال رمز التحقق إلى هاتفك عبر واتساب أو رسالة قصيرة'
          : 'Le code de vérification a été envoyé sur WhatsApp ou par SMS'
      );
    } catch (error) {
      console.error('SEND OTP ERROR:', error);

      // Differentiate server-side failures (DB / SMS provider) from
      // rate-limits or cooldown so the user gets a useful message instead
      // of a generic "try again". The API client surfaces the backend's
      // `error` field as the thrown Error's message.
      const code = error instanceof Error ? error.message : '';
      let ar: string;
      let fr: string;
      switch (code) {
        case 'tooManyRequests':
          ar = 'تجاوزت الحد المسموح من المحاولات. حاول لاحقاً.';
          fr = 'Trop de tentatives, reessayez plus tard.';
          break;
        case 'resendCooldown':
          ar = 'يرجى الانتظار قبل إعادة طلب الرمز.';
          fr = 'Veuillez patienter avant de renvoyer une demande.';
          break;
        case 'invalidPhone':
          ar = 'رقم الهاتف غير صحيح.';
          fr = 'Numero de telephone invalide.';
          break;
        case 'serverError':
        default:
          ar = 'تعذر إرسال الرمز، تأكد من اتصالك بالإنترنت أو حاول لاحقاً.';
          fr = 'Envoi du code impossible, verifiez votre connexion et reessayez.';
      }
      toast.error(isAr ? ar : fr);
    } finally {
      setLoading(false);
    }
  };

  // Driver self-registration: identical OTP step as the customer flow, but
  // after verifying the OTP we route the user into the driver-form step
  // (which calls /api/auth/apply-driver) instead of the customer signup.
  // SECURITY: the role is still forced server-side; this is only UX.
  const handleSendOtpAsDriver = async () => {
    const clean = normalizeAlgerianPhone(phone);
    if (!clean) {
      console.warn('[Driver Flow] Invalid Algerian phone, aborting:', phone);
      toast.error(
        isAr
          ? 'أدخل رقم هاتف جزائري صحيح'
          : 'Entrez un numéro de téléphone algérien valide'
      );
      return;
    }
    // DIAG: trace driver-flow entry so we can confirm the user actually
    // pressed the driver button (vs. the customer one) and follow the
    // request all the way to the server.
    console.log('[Driver Flow] Sending OTP as driver for phone:', clean);
    setLoading(true);
    // FIX: move the name-clearing *inside* this handler so it always
    // happens (regardless of which UI entry point calls it) and so the
    // customer name is never silently wiped from the wrong flow.
    setName('');
    setIntendsDriver(true);
    try {
      const result = await api.sendOtp(clean);
      console.log('[Driver Flow] OTP sent successfully for phone:', clean);
      setPhone(clean);
      setOtp('');
      setStep('otp');
      setResendTimer(30);
      // SECURITY (V?? — OTP bypass lock-down): the server no longer
      // returns the OTP in the response. Same generic "code sent"
      // message as the customer flow — never the digits themselves.
      toast.success(
        isAr
          ? 'تم إرسال رمز التحقق إلى هاتفك عبر واتساب أو رسالة قصيرة'
          : 'Le code de vérification a été envoyé sur WhatsApp ou par SMS'
      );
    } catch (error) {
      console.error('[Driver Flow] Failed to send OTP:', error);
      // Same error-code mapping as the customer flow (see handleSendOtp).
      const code = error instanceof Error ? error.message : '';
      let ar = 'تعذّر إرسال رمز التحقق. حاول مرة أخرى.';
      let fr = 'Impossible d’envoyer le code. Réessayez.';
      switch (code) {
        case 'tooManyRequests':
          ar = 'تجاوزت الحد المسموح من المحاولات. حاول لاحقاً.';
          fr = 'Trop de tentatives, reessayez plus tard.';
          break;
        case 'resendCooldown':
          ar = 'يرجى الانتظار قبل إعادة طلب الرمز.';
          fr = 'Veuillez patienter avant de renvoyer une demande.';
          break;
        case 'invalidPhone':
          ar = 'رقم الهاتف غير صحيح.';
          fr = 'Numero de telephone invalide.';
          break;
        case 'serverError':
          ar = 'تعذر إرسال الرمز، تأكد من اتصالك بالإنترنت أو حاول لاحقاً.';
          fr = 'Envoi du code impossible, verifiez votre connexion et reessayez.';
          break;
      }
      // DIAG: also surface the raw error code in the toast so the user
      // (and on-call support) can tell exactly which server-side failure
      // triggered it — without having to crack open the browser console.
      const surfaced = isAr
        ? `${ar} (الرمز: ${code || 'غير معروف'})`
        : `${fr} (code: ${code || 'inconnu'})`;
      toast.error(surfaced);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (otp.length !== OTP_LENGTH) {
      toast.error(
        isAr
          ? `أدخل رمز التحقق المكون من ${OTP_LENGTH} أرقام`
          : `Entrez le code à ${OTP_LENGTH} chiffres`
      );
      return;
    }

    // Double-submit guard (useRef-backed). Unlike a `verifying` state,
    // `verifyingRef.current` updates synchronously and reads are
    // immediately visible across the same event loop, so two click
    // events fired in rapid succession (double-tap, Enter + onClick,
    // onPaste + auto-submit) both see the lock held on the second
    // entry, and only the first verify-otp request is actually
    // dispatched. The state-based `verifying` is still set so the
    // button's `disabled` prop reflects the busy state to the user.
    if (verifyingRef.current) return;
    verifyingRef.current = true;
    setVerifying(true);
    setLoading(true);

    try {
      const result = await api.verifyOtp(
        phone,
        otp,
        name || undefined
      );

      // DIAG: log every result so we can tell whether the failure to
      // advance to driver-form is a missing flag, a wrong response shape,
      // or a successful route that did not propagate to setStep().
      console.log('[AUTH FLOW] handleVerify result', {
        requiresSignup: result.requiresSignup,
        driverApplicationPending: result.driverApplicationPending,
        driverApplicationRejected: result.driverApplicationRejected,
        hasUser: !!result.user,
        intendsDriver,
        userPhone: result.user?.phone,
      });

      if (result.requiresSignup) {
        // Fresh account: pick the right next step based on user intent.
        // The server doesn't know about `intendsDriver` (it's a client-only
        // UX flag), so for *fresh* accounts the only way to honour the
        // driver's intent is to trust the client flag and route them to
        // the driver form. The server will create the driver application
        // on the subsequent /api/auth/apply-driver call.
        //
        // Stale `intendsDriver=true` is prevented by the explicit reset
        // added at the top of handleSendOtp and at the OTP back-button.
        console.log('[AUTH FLOW] requiresSignup=true; branching on intendsDriver=', intendsDriver);
        if (intendsDriver) {
          // DIAG: confirm the router picked the driver branch (vs. the
          // customer one) so we can tell whether the user landed in
          // the right place even if a later step silently fails.
          console.log('[Driver Flow] OTP verified, moving to driver-form');
          setOtp('');
          setStep('driver-form');
          console.log('[AUTH FLOW] >>> setStep(\'driver-form\') called');
        } else {
          console.log('[AUTH FLOW] >>> setStep(\'signup\') called (customer branch)');
          setOtp('');
          setStep('signup');
        }
        return;
      }

      // Driver self-registration flow: existing user is a pending/rejected
      // driver. The server refused to issue a session and told us the
      // application status. Surface that to the driver so they know they
      // are waiting for admin approval (or can re-apply if rejected).
      if (result.driverApplicationPending) {
        setStep('driver-pending');
        return;
      }
      if (result.driverApplicationRejected) {
        setStep('driver-rejected');
        return;
      }

      if (!result.user) throw new Error('Authenticated user missing');
      setUser(result.user);

      toast.success(
        isAr
          ? `أهلاً ${result.user.name ?? ''}`
          : `Bienvenue ${result.user.name ?? ''}`
      );
    } catch (error) {
      // Clear the OTP boxes after any verify-otp failure so the user
      // can re-enter a fresh code without leftover digits confusing the UI.
      setOtp('');
      console.error('VERIFY OTP ERROR:', error);

      // Map each backend error code to a specific user-facing message so the
      // user (and support) can tell whether the code is wrong, expired, not
      // yet requested, rate-limited, or whether the server crashed. The API
      // client surfaces the backend's `error` field as the thrown Error's
      // message.
      const code =
        error instanceof Error ? error.message : '';

      let ar: string;
      let fr: string;

      switch (code) {
        case 'codeExpired':
          ar = 'انتهت صلاحية الرمز، يرجى طلب رمز جديد.';
          fr = 'Code expire, veuillez demander un nouveau code.';
          break;
        case 'codeNotFound':
          ar = 'لم يتم العثور على رمز، يرجى طلب رمز جديد.';
          fr = 'Aucun code trouve, veuillez en demander un nouveau.';
          break;
        case 'tooManyAttempts':
          ar = 'تجاوزت عدد المحاولات، حاول لاحقاً.';
          fr = 'Trop de tentatives, reessayez plus tard.';
          break;
        case 'serverError':
          ar = 'حدث خطأ تقني في الخادم. يرجى المحاولة مرة أخرى.';
          fr = 'Une erreur technique est survenue. Veuillez reessayer.';
          break;
        case 'invalidPhone':
          ar = 'رقم الهاتف غير صحيح.';
          fr = 'Numero de telephone invalide.';
          break;
        case 'invalidOtp':
        default:
          ar = 'رمز التحقق غير صحيح.';
          fr = 'Code de verification incorrect.';
      }

      toast.error(isAr ? ar : fr);
    } finally {
      verifyingRef.current = false;
      setVerifying(false);
      setLoading(false);
    }
  };

  const handleCompleteSignup = async () => {
    if (name.trim().length < 2) {
      toast.error(isAr ? 'أدخل الاسم الكامل' : 'Entrez votre nom complet');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      toast.error(isAr ? 'أدخل بريدًا إلكترونيًا صحيحًا' : 'Entrez un email valide');
      return;
    }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password)) {
      toast.error(isAr ? 'كلمة المرور: 8 أحرف، حرف كبير، حرف صغير ورقم' : 'Mot de passe: 8 caractères, majuscule, minuscule et chiffre');
      return;
    }
    if (password !== confirmPassword) {
      toast.error(isAr ? 'كلمتا المرور غير متطابقتين' : 'Les mots de passe ne correspondent pas');
      return;
    }
    setLoading(true);
    try {
      const { user } = await api.completeSignup({ name, email, password, confirmPassword });
      setUser(user);
      toast.success(isAr ? 'تم إنشاء حسابك بنجاح' : 'Votre compte a été créé avec succès');
    } catch (error) {
      console.error('COMPLETE SIGNUP ERROR:', error);
      toast.error(isAr ? 'تعذّر إنشاء الحساب. تحقق من البيانات.' : 'Impossible de créer le compte. Vérifiez vos données.');
    } finally {
      setLoading(false);
    }
  };

  // Driver self-registration: send vehicle registration (carte grise) details
  // to the server. The server forces role="driver" + accountStatus="pending".
  // No session is returned here — the driver remains in the pending state
  // until an admin approves the application.
  const handleApplyDriver = async () => {
    if (name.trim().length < 2) {
      toast.error(isAr ? 'أدخل الاسم الكامل' : 'Entrez votre nom complet');
      return;
    }
    const vr = vehicleRegistration;
    if (!vr.numeroImmatriculation.trim()) {
      toast.error(
        isAr ? 'أدخل رقم التسجيل' : 'Entrez le numero d\'immatriculation'
      );
      return;
    }
    if (vr.typeProprietaire === 'PERSONNE_PHYSIQUE') {
      if (!vr.nom.trim() || !vr.prenom.trim()) {
        toast.error(
          isAr ? 'أدخل اسم المالك ولقبه' : 'Entrez le nom et le prenom du proprietaire'
        );
        return;
      }
    } else if (!vr.raisonSociale.trim()) {
      toast.error(
        isAr ? 'أدخل اسم الشركة' : 'Entrez la raison sociale du proprietaire'
      );
      return;
    }
    if (!vr.marque.trim()) {
      toast.error(isAr ? 'أدخل ماركة المركبة' : 'Entrez la marque du vehicule');
      return;
    }
    if (!vr.datePremiereMiseEnCirculation.trim()) {
      toast.error(
        isAr
          ? 'أدخل تاريخ أول وضع للسير'
          : 'Entrez la date de première mise en circulation'
      );
      return;
    }
    if (!vr.adresse.trim()) {
      toast.error(
        isAr ? 'أدخل عنوان المالك' : 'Entrez l’adresse du proprietaire'
      );
      return;
    }
    const year = parseInt(vr.anneePremiereMiseCirculation, 10);
    const currentYear = new Date().getFullYear();
    if (
      !Number.isFinite(year) ||
      year < 1950 ||
      year > currentYear + 1
    ) {
      toast.error(
        isAr
          ? `أدخل سنة صحيحة بين 1950 و ${currentYear + 1}`
          : `Entrez une annee valide entre 1950 et ${currentYear + 1}`
      );
      return;
    }
    // Number of passenger seats is required for TAXI / BOTH drivers and
    // ignored for CARGO. The server re-validates and returns 400 on
    // garbage, so this is a friendly pre-check that keeps the user out
    // of the error toast loop.
    if (vr.serviceType !== 'CARGO') {
      const seatsN = parseInt(vr.seats, 10);
      if (!Number.isFinite(seatsN) || seatsN < 1 || seatsN > 30) {
        toast.error(
          isAr
            ? 'أدخل عدد مقاعد صحيح بين 1 و 30'
            : 'Entrez un nombre de places valide (1 a 30)'
        );
        return;
      }
    }
    setLoading(true);
    try {
      // DIAG: log the exact payload we're about to POST so we can confirm
      // the form values reached the wire (and aren't, say, silently wiped
      // by a stale closure). Trim-sensitive fields are shown trimmed.
      const submitPayload = {
        name: name.trim(),
        numeroImmatriculation: vr.numeroImmatriculation.trim(),
        typeProprietaire: vr.typeProprietaire,
        nom: vr.typeProprietaire === 'PERSONNE_PHYSIQUE' ? vr.nom.trim() : undefined,
        prenom: vr.typeProprietaire === 'PERSONNE_PHYSIQUE' ? vr.prenom.trim() : undefined,
        raisonSociale: vr.typeProprietaire === 'PERSONNE_MORALE' ? vr.raisonSociale.trim() : undefined,
        marque: vr.marque.trim(),
        type: vr.type.trim() || undefined,
        anneePremiereMiseCirculation: year,
        // Carte grise extended fields.
        datePremiereMiseEnCirculation: vr.datePremiereMiseEnCirculation.trim(),
        adresse: vr.adresse.trim(),
        // Cargo capacity is optional and only displayed for CARGO / BOTH
        // drivers in the form; we forward it as-is to the server.
        ptac: vr.ptac.trim() || undefined,
        // Number of passenger seats. Only meaningful for TAXI / BOTH; the
        // server stores null for CARGO regardless of what we send.
        seats: vr.serviceType === 'CARGO'
          ? undefined
          : (parseInt(vr.seats, 10) || undefined),
        // `serviceType` decides which orders this driver will receive
        // once approved: "CARGO" (parcels / furniture), "TAXI" (passenger
        // transport, Yassir-like) or "BOTH" (default fallback on the
        // server if the client omits it). The server validates the
        // value against an allow-list and rejects anything else.
        serviceType: vr.serviceType,
      };
      console.log('[Driver Flow] Submitting driver application:', submitPayload);
      const result = await api.applyDriver(submitPayload);
      console.log('[Driver Flow] Application submitted successfully:', result);
      toast.success(
        isAr
          ? 'أرسل طلبك. سيتم المراجعة من طرف المدير.'
          : 'Demande envoyée. L\u2019administrateur va la passer en revue.'
      );
      setStep('driver-pending');
    } catch (error) {
      // DIAG: surface the full error (including stack) and forward the
      // server's error code to the toast so the user + support can see
      // *why* the application failed without opening devtools.
      console.error('[Driver Flow] Failed to submit application:', error);
      const msg = error instanceof Error ? error.message : '';
      toast.error(
        isAr
          ? `فشل إرسال الطلب: ${msg || 'خطأ غير معروف'}`
          : `Échec de l'envoi : ${msg || 'erreur inconnue'}`
      );
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      toast.error(isAr ? 'أدخل البريد الإلكتروني وكلمة المرور' : 'Entrez votre email et votre mot de passe');
      return;
    }
    setLoading(true);
    try {
      const { user } = await api.login(email, password);
      if (!user) throw new Error('Authenticated user missing');
      setUser(user);
      toast.success(isAr ? `أهلاً ${user.name}` : `Bienvenue ${user.name}`);
    } catch (error) {
      console.error('EMAIL LOGIN ERROR:', error);
      toast.error(isAr ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة' : 'Email ou mot de passe incorrect');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestPasswordReset = async () => {
    const clean = normalizeAlgerianPhone(forgotPhone);
    if (!clean) {
      toast.error(isAr ? 'Enter phone' : 'Entrez numero');
      return;
    }
    setLoading(true);
    try {
      const result = await api.requestPasswordReset(clean);
      setForgotPhone(clean);
      setOtp('');
      setStep('forgot-otp');
      setResendTimer(30);
      // SECURITY (V?? — OTP bypass lock-down): the password-reset
      // endpoint no longer echoes the code. The user gets a generic
      // "code sent" message — same as the regular OTP path.
      toast.success(
        isAr
          ? 'تم إرسال رمز إعادة التعيين عبر واتساب أو رسالة قصيرة'
          : 'Le code de réinitialisation a été envoyé sur WhatsApp ou par SMS'
      );
    } catch (error) {
      console.error('REQUEST RESET ERROR:', error);
      // Same error-code mapping as the customer flow (see handleSendOtp).
      const code = error instanceof Error ? error.message : '';
      let ar = 'حدث خطأ. حاول مرة أخرى.';
      let fr = 'Erreur, reessayez.';
      switch (code) {
        case 'tooManyRequests':
          ar = 'تجاوزت الحد المسموح من المحاولات. حاول لاحقاً.';
          fr = 'Trop de tentatives, reessayez plus tard.';
          break;
        case 'resendCooldown':
          ar = 'يرجى الانتظار قبل إعادة طلب الرمز.';
          fr = 'Veuillez patienter avant de renvoyer une demande.';
          break;
        case 'invalidPhone':
          ar = 'رقم الهاتف غير صحيح.';
          fr = 'Numero de telephone invalide.';
          break;
        case 'serverError':
          ar = 'تعذر إرسال الرمز، تأكد من اتصالك بالإنترنت أو حاول لاحقاً.';
          fr = 'Envoi du code impossible, verifiez votre connexion et reessayez.';
          break;
      }
      toast.error(isAr ? ar : fr);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyForgotOtp = async () => {
    if (otp.length !== OTP_LENGTH) return;
    // Double-submit guard (useRef-backed). See handleVerify for details.
    if (verifyingRef.current) return;
    verifyingRef.current = true;
    setVerifying(true);
    setLoading(true);
    try {
      const result = await api.verifyOtp(forgotPhone, otp);
      if (result.requiresSignup) {
        toast.error(isAr ? 'Account not found' : 'Compte non trouve');
        return;
      }
      if (!result.user) throw new Error('Missing user');
      setOtp('');
      setStep('forgot-reset');
      setPassword('');
      setConfirmPassword('');
    } catch (error) {
      console.error('VERIFY FORGOT OTP ERROR:', error);

      // Same error-code → user-facing-message mapping as the login OTP flow
      // (see handleVerify). Keeps the forgot-password UX consistent with the
      // main login screen.
      const code = error instanceof Error ? error.message : '';
      let ar = 'رمز التحقق غير صحيح أو انتهت صلاحيته';
      let fr = 'Code incorrect ou expire';
      switch (code) {
        case 'codeExpired':
          ar = 'انتهت صلاحية الرمز، يرجى طلب رمز جديد.';
          fr = 'Code expire, veuillez demander un nouveau code.';
          break;
        case 'codeNotFound':
          ar = 'لم يتم العثور على رمز، يرجى طلب رمز جديد.';
          fr = 'Aucun code trouve, veuillez en demander un nouveau.';
          break;
        case 'tooManyAttempts':
          ar = 'تجاوزت عدد المحاولات، حاول لاحقاً.';
          fr = 'Trop de tentatives, reessayez plus tard.';
          break;
        case 'serverError':
          ar = 'حدث خطأ تقني في الخادم. يرجى المحاولة مرة أخرى.';
          fr = 'Une erreur technique est survenue. Veuillez reessayer.';
          break;
        case 'invalidPhone':
          ar = 'رقم الهاتف غير صحيح.';
          fr = 'Numero de telephone invalide.';
          break;
      }
      toast.error(isAr ? ar : fr);
    } finally {
      verifyingRef.current = false;
      setVerifying(false);
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (password.length < 8) {
      toast.error('8 chars min');
      return;
    }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password)) {
      toast.error('Need upper lower digit');
      return;
    }
    if (password !== confirmPassword) {
      toast.error(isAr ? 'Passwords do not match' : 'Ne correspondent pas');
      return;
    }
    setLoading(true);
    try {
      const { user } = await api.resetPassword({ code: otp, password, confirmPassword });
      setUser(user);
      toast.success(isAr ? 'Password changed' : 'Mot de passe change');
    } catch (error) {
      console.error('RESET PASSWORD ERROR:', error);
      toast.error(isAr ? 'Error' : 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = async (role: Role) => {
    setLoading(true);

    try {
      const { user } = await api.loginAs(role);

      if (!user) throw new Error('Authenticated user missing');

      setUser(user);

      toast.success(
        isAr
          ? `أهلاً ${user.name}`
          : `Bienvenue ${user.name}`
      );
    } catch (error) {
      console.error('QUICK LOGIN ERROR:', error);

      toast.error(
        isAr
          ? 'فشل تسجيل الدخول'
          : 'أ‰chec de connexion'
      );
    } finally {
      setLoading(false);
    }
  };

  // =========================
  // ONBOARDING
  // =========================

  if (step === 'onboarding') {
    return (
      <div className="relative flex min-h-screen flex-col overflow-hidden bg-primary text-white">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/5" />

        <div className="pointer-events-none absolute -left-20 top-1/2 h-72 w-72 rounded-full bg-white/5" />

        <div className="pointer-events-none absolute bottom-0 right-1/4 h-64 w-64 rounded-full bg-[#FF7A00]/10" />

        <div className="relative z-10 flex items-center justify-between p-5">
          <div className="flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 backdrop-blur">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-300" />

            <span className="text-xs font-semibold">
              {t.location}
            </span>
          </div>

          <LangToggle variant="ghost" />
        </div>

        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="animate-float mb-8">
            <div className="flex h-28 w-28 items-center justify-center rounded-[2rem] bg-white shadow-2xl">
              <BrandLogo size={72} />
            </div>
          </div>

          <h1 className="text-5xl font-black tracking-tight">
            {t.appName}
          </h1>

          <p className="mt-1 text-sm font-bold uppercase tracking-[0.3em] text-white/70">
            {t.appSub} آ· TRI PORTEUR
          </p>

          <p className="mt-5 max-w-sm text-balance text-base text-white/85">
            {t.welcomeSub}
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
            <FeaturePill
              icon={ShieldCheck}
              label={t.securedBy}
            />

            <FeaturePill
              icon={Headphones}
              label={t.support24}
            />

            <FeaturePill
              icon={Bike}
              label={t.realtimeActive}
            />
          </div>
        </div>

        <div className="relative z-10 space-y-3 px-6 pb-10 pt-4">
          <Button
            onClick={() => setStep('phone')}
            size="lg"
            className="h-14 w-full rounded-2xl bg-white text-base font-bold text-primary shadow-xl hover:bg-white/90"
          >
            <Phone size={20} className="me-2" />
            {t.startNow}
          </Button>

          {ENABLE_DEMO_LOGIN && (
            <div className="pt-2">
              <p className="mb-2 text-center text-xs font-medium text-white/60">
                {t.pickRole}
              </p>

              <div className="grid grid-cols-3 gap-2">
                <DemoBtn
                  icon={Package}
                  label={t.customer}
                  onClick={() =>
                    handleQuickLogin('customer')
                  }
                  loading={loading}
                />

                <DemoBtn
                  icon={Bike}
                  label={t.driver}
                  onClick={() =>
                    handleQuickLogin('driver')
                  }
                  loading={loading}
                />

                <DemoBtn
                  icon={ShieldCheck}
                  label={t.admin}
                  onClick={() =>
                    handleQuickLogin('admin')
                  }
                  loading={loading}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // =========================
  // PHONE
  // =========================

  if (step === 'phone') {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <div className="flex items-center justify-between p-5">
          <button
            onClick={() => setStep('onboarding')}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-sm"
          >
            {isAr ? (
              <ArrowRight size={20} />
            ) : (
              <ArrowLeft size={20} />
            )}
          </button>

          <LangToggle />
        </div>

        <div className="flex flex-1 flex-col px-6">
          <div className="mb-8 mt-4">
            <BrandLogo size={56} showText />
          </div>

          <h2 className="text-2xl font-black text-foreground">
            {t.phoneLogin}
          </h2>

          <p className="mt-2 text-sm text-muted-foreground">
            {t.welcome} €” {t.tagline}
          </p>

          <div className="mt-8 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                {t.phoneHint}
              </label>

              <div className="flex items-center gap-2">
                <div className="flex h-12 items-center gap-1.5 rounded-xl border border-border bg-card px-3">
                  <span className="text-lg">🇩🇿</span>

                  <span
                    className="text-sm font-bold text-foreground"
                    dir="ltr"
                  >
                    +213
                  </span>
                </div>

                <Input
                  dir="ltr"
                  inputMode="tel"
                  placeholder={t.phonePlaceholder}
                  value={phone}
                  onChange={(e) =>
                    setPhone(e.target.value)
                  }
                  className="h-12 flex-1 text-start font-semibold tracking-wide"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSendOtp();
                    }
                  }}
                />
              </div>
            </div>

            <Button
              onClick={handleSendOtp}
              disabled={loading}
              size="lg"
              className="h-12 w-full rounded-xl bg-primary text-sm font-bold shadow-lg"
            >
              {loading ? (
                <Sparkles
                  className="animate-spin"
                  size={18}
                />
              ) : (
                <Phone size={18} className="me-2" />
              )}

              {t.sendOTP}
            </Button>

            <button
              type="button"
              onClick={() => setStep('login')}
              className="w-full text-center text-xs font-bold text-primary hover:underline"
            >
              {isAr
                ? 'الدخول بالبريد الإلكتروني وكلمة المرور'
                : 'Connexion par email et mot de passe'}
            </button>
          </div>

          <div className="mt-auto pb-6 pt-8">
            <div className="flex items-center justify-center gap-2 rounded-xl bg-muted/50 p-3 text-center text-xs text-muted-foreground">
              <ShieldCheck
                size={14}
                className="text-primary"
              />

              {t.securedBy} آ·{' '}
              {isAr
                ? 'رمز تحقق آمن'
                : 'Code de vérification sécurisé'}
            </div>
          </div>
        </div>
      </div>
    );
  }


  if (step === 'forgot-phone') {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <div className="flex items-center justify-between p-5">
          <button
            onClick={() => setStep('login')}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-sm"
          >
            {isAr ? <ArrowRight size={20} /> : <ArrowLeft size={20} />}
          </button>
          <LangToggle />
        </div>
        <div className="flex flex-1 flex-col px-6">
          <div className="mb-8 mt-4"><BrandLogo size={56} showText /></div>
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <Key size={30} className="text-primary" />
          </div>
          <h2 className="text-2xl font-black text-foreground">
            {isAr ? 'نسيت كلمة المرور' : 'Mot de passe oublie'}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {isAr ? 'أدخل رقم هاتفك لاستلام رمز التحقق' : 'Entrez votre numero de telephone pour recevoir un code'}
          </p>
          <div className="mt-8 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                {isAr ? 'رقم الهاتف' : 'Numero de telephone'}
              </label>
              <div className="flex items-center gap-2">
                <div className="flex h-12 items-center gap-1.5 rounded-xl border border-border bg-card px-3">
                  <span className="text-lg">🇩🇿</span>
                  <span className="text-sm font-bold text-foreground" dir="ltr">+213</span>
                </div>
                <Input
                  dir="ltr"
                  inputMode="tel"
                  placeholder="5XX XX XX XX"
                  value={forgotPhone}
                  onChange={(e) => setForgotPhone(e.target.value)}
                  className="h-12 flex-1 text-start font-semibold tracking-wide"
                />
              </div>
            </div>
            <Button onClick={handleRequestPasswordReset} disabled={loading} size="lg" className="h-12 w-full rounded-xl bg-primary text-sm font-bold shadow-lg">
              {loading ? <Sparkles className="animate-spin" size={18} /> : null}
              {isAr ? 'إرسال الرمز' : 'Envoyer le code'}
            </Button>
          </div>
        </div>
      </div>
    );
  }



  if (step === 'forgot-otp') {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <div className="flex items-center justify-between p-5">
          <button
            onClick={() => setStep('forgot-phone')}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-sm"
          >
            {isAr ? <ArrowRight size={20} /> : <ArrowLeft size={20} />}
          </button>
          <LangToggle />
        </div>
        <div className="flex flex-1 flex-col px-6">
          <div className="mb-8 mt-4"><BrandLogo size={56} showText /></div>
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <ShieldCheck size={30} className="text-primary" />
          </div>
          <h2 className="text-2xl font-black text-foreground">
            {isAr ? 'رمز التحقق' : 'Code de verification'}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {isAr ? 'أدخل الرمز المرسل إلى' : 'Entrez le code envoye au'}{' '}
            <span dir="ltr" className="font-bold text-foreground">+213 {forgotPhone}</span>
          </p>
          <div className="mt-8 flex justify-center" dir="ltr">
            <InputOTP maxLength={OTP_LENGTH} value={otp} onChange={setOtp}>
              <InputOTPGroup className="gap-2">
                {Array.from({ length: OTP_LENGTH }).map((_, index) => (
                  <InputOTPSlot key={index} index={index} className={cn('h-14 rounded-xl border-2 text-xl font-bold', OTP_LENGTH === 6 ? 'w-10 sm:w-12' : 'w-12')} />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>
          <Button onClick={handleVerifyForgotOtp} disabled={loading || verifyingRef.current || otp.length !== OTP_LENGTH} size="lg" className="mt-8 h-12 w-full rounded-xl bg-primary text-sm font-bold shadow-lg">
            {loading ? <Sparkles className="animate-spin" size={18} /> : null}
            {isAr ? 'تحقق' : 'Verifier'}
          </Button>
          <div className="mt-4 text-center">
            {resendTimer > 0 ? (
              <p className="text-xs text-muted-foreground">
                {isAr ? 'إعادة الإرسال خلال' : 'Renvoyer dans'} {resendTimer} {isAr ? 'ثانية' : 's'}
              </p>
            ) : (
              <button onClick={handleRequestPasswordReset} className="text-xs font-bold text-primary hover:underline">
                {isAr ? 'إعادة إرسال الرمز' : 'Renvoyer le code'}
              </button>
            )}
          </div>
          <div className="mt-auto pb-6 pt-8">
            <div className="rounded-xl bg-amber-50 p-3 text-center text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
              {/* SECURITY (V?? — OTP bypass lock-down): the demo
                  banner that printed the literal "0000" code has been
                  removed. Production users now see a generic "enter
                  the 6-digit code" hint; demo mode is for local dev
                  only and the dev reads the code from the server
                  logs, not the client UI. */}
              {isAr
                ? 'أدخل الرمز المكون من 6 أرقام المرسل عبر SMS أو واتساب'
                : 'Entrez le code a 6 chiffres recu par SMS ou WhatsApp'}
            </div>
          </div>
        </div>
      </div>
    );
  }



  if (step === 'forgot-reset') {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <div className="flex items-center justify-between p-5">
          <button
            onClick={() => setStep('forgot-otp')}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-sm"
          >
            {isAr ? <ArrowRight size={20} /> : <ArrowLeft size={20} />}
          </button>
          <LangToggle />
        </div>
        <div className="flex flex-1 flex-col px-6">
          <div className="mb-8 mt-4"><BrandLogo size={56} showText /></div>
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <Lock size={30} className="text-primary" />
          </div>
          <h2 className="text-2xl font-black text-foreground">
            {isAr ? 'كلمة مرور جديدة' : 'Nouveau mot de passe'}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {isAr ? '8 أحرف على الأقل، تحتوي على حرف كبير وصغير ورقم' : '8 caracteres min, avec majuscule, minuscule et chiffre'}
          </p>
          <div className="mt-8 space-y-4">
            <Input type="password" dir="ltr" placeholder={isAr ? 'كلمة المرور الجديدة' : 'Nouveau mot de passe'} value={password} onChange={(e) => setPassword(e.target.value)} className="h-12" />
            <Input type="password" dir="ltr" placeholder={isAr ? 'تأكيد كلمة المرور' : 'Confirmer le mot de passe'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="h-12" onKeyDown={(e) => { if (e.key === 'Enter') handleResetPassword(); }} />
            <Button onClick={handleResetPassword} disabled={loading} size="lg" className="h-12 w-full rounded-xl bg-primary text-sm font-bold shadow-lg">
              {loading ? <Sparkles className="animate-spin" size={18} /> : null}
              {isAr ? 'تغيير كلمة المرور' : 'Changer le mot de passe'}
            </Button>
          </div>
        </div>
      </div>
    );
  }


  if (step === 'login') {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <div className="flex items-center justify-between p-5">
          <button
            onClick={() => setStep('onboarding')}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-sm"
          >
            {isAr ? <ArrowRight size={20} /> : <ArrowLeft size={20} />}
          </button>
          <LangToggle />
        </div>
        <div className="flex flex-1 flex-col px-6">
          <div className="mb-8 mt-4"><BrandLogo size={56} showText /></div>
          <h2 className="text-2xl font-black text-foreground">
            {isAr ? 'تسجيل الدخول' : 'Connexion'}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {isAr ? 'استخدم بريدك الإلكتروني وكلمة المرور' : 'Utilisez votre email et votre mot de passe'}
          </p>
          <div className="mt-8 space-y-4">
            <Input type="email" dir="ltr" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-12" />
            <Input type="password" dir="ltr" placeholder={isAr ? 'كلمة المرور' : 'Mot de passe'} value={password} onChange={(e) => setPassword(e.target.value)} className="h-12" onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }} />
            <button type="button" onClick={() => { setForgotPhone(''); setOtp(''); setStep('forgot-phone'); }} className="text-xs font-bold text-primary hover:underline self-end">{isAr ? 'نسيت كلمة المرور' : 'Mot de passe oublie ?'}</button>
            <Button onClick={handleLogin} disabled={loading} size="lg" className="h-12 w-full rounded-xl bg-primary text-sm font-bold shadow-lg">
              {loading ? <Sparkles className="animate-spin" size={18} /> : null}
              {isAr ? 'دخول' : 'Se connecter'}
            </Button>
            <button type="button" onClick={() => setStep('phone')} className="w-full text-center text-xs font-bold text-primary hover:underline">
              {isAr ? 'تسجيل حساب جديد عبر الهاتف' : 'Créer un compte avec votre téléphone'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'signup') {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <div className="flex items-center justify-between p-5"><LangToggle /></div>
        <div className="flex flex-1 flex-col px-6">
          <div className="mb-8 mt-4"><BrandLogo size={56} showText /></div>
          <h2 className="text-2xl font-black text-foreground">
            {isAr ? 'إنشاء حسابك' : 'Créer votre compte'}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {isAr ? 'تم التحقق من رقم هاتفك بنجاح. أكمل بياناتك لإنشاء حسابك في وصّلها.' : 'Votre téléphone est vérifié. Complétez vos informations pour créer votre compte.'}
          </p>
          <div className="mt-5 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" dir="ltr">
            ✓ {phone} - {isAr ? 'رقم الهاتف مؤكّد' : 'Téléphone confirmé'}
          </div>
          <div className="mt-5 space-y-3">
            <Input placeholder={isAr ? 'الاسم الكامل' : 'Nom complet'} value={name} onChange={(e) => setName(e.target.value)} className="h-12" />
            <Input type="email" dir="ltr" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-12" />
            <Input type="password" dir="ltr" placeholder={isAr ? 'كلمة المرور' : 'Mot de passe'} value={password} onChange={(e) => setPassword(e.target.value)} className="h-12" />
            <Input type="password" dir="ltr" placeholder={isAr ? 'تأكيد كلمة المرور' : 'Confirmer le mot de passe'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="h-12" onKeyDown={(e) => { if (e.key === 'Enter') handleCompleteSignup(); }} />
            <Button onClick={handleCompleteSignup} disabled={loading} size="lg" className="h-12 w-full rounded-xl bg-primary text-sm font-bold shadow-lg">
              {loading ? <Sparkles className="animate-spin" size={18} /> : null}
              {isAr ? 'إنشاء الحساب' : 'Créer le compte'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // =========================
  // OTP
  // =========================

  if (step === 'otp') {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex items-center justify-between p-5">
        <button
          onClick={() => {
            setStep('phone');
            setOtp('');
            // FIX: also clear the "intends driver" flag when the user
            // backs out of the OTP screen. Without this, going back
            // and re-entering the customer path would still keep
            // intendsDriver=true (now handled in handleSendOtp too,
            // but defense in depth).
            setIntendsDriver(false);
          }}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-sm"
        >
          {isAr ? (
            <ArrowRight size={20} />
          ) : (
            <ArrowLeft size={20} />
          )}
        </button>

        <LangToggle />
      </div>

      <div className="flex flex-1 flex-col px-6">
        <div className="mb-8 mt-4">
          <BrandLogo size={56} showText />
        </div>

        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <ShieldCheck
            size={30}
            className="text-primary"
          />
        </div>

        <h2 className="text-2xl font-black text-foreground">
          {t.otpTitle}
        </h2>

        <p className="mt-2 text-sm text-muted-foreground">
          {isAr
            ? 'أدخل رمز التحقق المرسل إلى'
            : 'Entrez le code envoyé au'}{' '}
          <span
            dir="ltr"
            className="font-bold text-foreground"
          >
            +213 {phone}
          </span>
        </p>

        <div
          className="mt-8 flex justify-center"
          dir="ltr"
        >
          <InputOTP
            maxLength={OTP_LENGTH}
            value={otp}
            onChange={setOtp}
          >
            <InputOTPGroup className="gap-2">
              {Array.from({ length: OTP_LENGTH }).map((_, index) => (
                <InputOTPSlot
                  key={index}
                  index={index}
                  className={cn(
                    'h-14 rounded-xl border-2 text-xl font-bold',
                    OTP_LENGTH === 6
                      ? 'w-10 sm:w-12'
                      : 'w-12'
                  )}
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>

        <p className="mt-6 text-center text-xs font-semibold text-muted-foreground">
          {t.selectRole}
        </p>

        <Tabs
          value={intendsDriver ? 'driver' : 'customer'}
          onValueChange={(v) =>
            setIntendsDriver(v === 'driver')
          }
          className="mt-2 w-full"
        >
          <TabsList className="inline-flex h-12 w-full rounded-xl p-1">
            <TabsTrigger
              value="customer"
              className="h-full flex-1 rounded-lg text-sm font-bold data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm"
            >
              <Package size={16} className="me-1.5 shrink-0" />
              {t.customerTab}
            </TabsTrigger>
            <TabsTrigger
              value="driver"
              className="h-full flex-1 rounded-lg text-sm font-bold data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm"
            >
              <Bike size={16} className="me-1.5 shrink-0" />
              {t.driverTab}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <Button
          onClick={handleVerify}
          disabled={
            loading || verifyingRef.current || otp.length !== OTP_LENGTH
          }
          size="lg"
          className="mt-6 h-12 w-full rounded-xl bg-primary text-sm font-bold shadow-lg"
        >
          {loading ? (
            <Sparkles
              className="animate-spin"
              size={18}
            />
          ) : null}

          {t.verify}
        </Button>

        <div className="mt-4 text-center">
          {resendTimer > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t.resendIn} {resendTimer}{' '}
              {t.seconds}
            </p>
          ) : (
            <button
              onClick={() => {
                // FIX: route the resend through the same path the user
                // originally took. The user now picks the role via the
                // Tabs on this screen, so `intendsDriver` already
                // reflects their choice. `handleSendOtp` would reset it
                // to false, which would dump the driver back into the
                // customer signup branch on the next verify. The
                // as-driver variant preserves the flag.
                if (intendsDriver) {
                  console.log('[Driver Flow] Resending OTP via driver handler');
                  handleSendOtpAsDriver();
                } else {
                  handleSendOtp();
                }
              }}
              className="text-xs font-bold text-primary hover:underline"
            >
              {t.resend}
            </button>
          )}
        </div>

        <div className="mt-auto pb-6 pt-8">
          <div className="rounded-xl bg-amber-50 p-3 text-center text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
            {/* SECURITY (V?? — OTP bypass lock-down): the demo
                banner that printed the literal "0000" code has been
                removed. See the matching block in the customer OTP
                screen. */}
            {isAr
              ? 'أدخل الرمز المكون من 6 أرقام المرسل عبر SMS أو واتساب'
              : 'Entrez le code à 6 chiffres reçu par SMS ou WhatsApp'}
          </div>
        </div>
      </div>
    </div>
  );
  }

  if (step === 'driver-form') {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <div className="flex items-center justify-between p-5">
          <button
            onClick={() => setStep('phone')}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-sm"
          >
            {isAr ? <ArrowRight size={20} /> : <ArrowLeft size={20} />}
          </button>
          <LangToggle />
        </div>
        <div className="flex flex-1 flex-col px-6 pb-8">
          <div className="mb-6 mt-2">
            <BrandLogo size={56} showText />
          </div>
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <Bike size={30} className="text-primary" />
          </div>
          <h2 className="text-2xl font-black text-foreground">
            {isAr ? 'تسجيل السائق' : 'Inscription chauffeur'}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {isAr
              ? 'أرسل طلبك. سيتم المراجعة من طرف المدير.'
              : 'Envoyez votre demande. L\u2019administrateur la passera en revue.'}
          </p>
          <div className="mt-6 space-y-5">
            {/* Driver identity (carte grise "owner-driver" name) */}
            <div>
              <label className="mb-1 block text-xs font-bold text-muted-foreground">
                {isAr ? 'الاسم الكامل' : 'Nom complet'}
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={isAr ? 'الاسم' : 'Nom'}
                className="h-12 rounded-xl"
              />
            </div>

            {/* Section: Vehicle registration (carte grise) */}
            <div className="rounded-2xl border border-border bg-muted/30 p-4">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-primary">
                {isAr ? 'بيانات البطاقة الرمادية' : 'Carte grise'}
              </p>

              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-muted-foreground">
                    {isAr ? 'رقم التسجيل' : "Numero d'immatriculation"}
                    <span className="text-destructive"> *</span>
                  </label>
                  <Input
                    value={vehicleRegistration.numeroImmatriculation}
                    onChange={(e) =>
                      updateVehicleRegistration('numeroImmatriculation', e.target.value)
                    }
                    placeholder={isAr ? 'مثال: 12345-A-06' : 'ex: 12345-A-06'}
                    className="h-12 rounded-xl"
                    dir="ltr"
                    required
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-muted-foreground">
                    {isAr ? 'نوع المالك' : 'Type de proprietaire'}
                    <span className="text-destructive"> *</span>
                  </label>
                  <select
                    value={vehicleRegistration.typeProprietaire}
                    onChange={(e) =>
                      updateVehicleRegistration(
                        'typeProprietaire',
                        e.target.value as 'PERSONNE_PHYSIQUE' | 'PERSONNE_MORALE'
                      )
                    }
                    className="h-12 w-full rounded-xl border bg-card px-3 text-sm"
                    dir="ltr"
                  >
                    <option value="PERSONNE_PHYSIQUE">
                      {isAr ? 'شخص طبيعي' : 'Personne physique'}
                    </option>
                    <option value="PERSONNE_MORALE">
                      {isAr ? 'شخص معنوي' : 'Personne morale'}
                    </option>
                  </select>
                </div>

                {vehicleRegistration.typeProprietaire === 'PERSONNE_PHYSIQUE' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-xs font-bold text-muted-foreground">
                        {isAr ? 'الاسم' : 'Nom'}
                        <span className="text-destructive"> *</span>
                      </label>
                      <Input
                        value={vehicleRegistration.nom}
                        onChange={(e) => updateVehicleRegistration('nom', e.target.value)}
                        placeholder={isAr ? 'اللقب' : 'Nom'}
                        className="h-12 rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-muted-foreground">
                        {isAr ? 'اللقب' : 'Prenom'}
                        <span className="text-destructive"> *</span>
                      </label>
                      <Input
                        value={vehicleRegistration.prenom}
                        onChange={(e) => updateVehicleRegistration('prenom', e.target.value)}
                        placeholder={isAr ? 'الاسم' : 'Prenom'}
                        className="h-12 rounded-xl"
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="mb-1 block text-xs font-bold text-muted-foreground">
                      {isAr ? 'اسم الشركة' : 'Raison sociale'}
                      <span className="text-destructive"> *</span>
                    </label>
                    <Input
                      value={vehicleRegistration.raisonSociale}
                      onChange={(e) =>
                        updateVehicleRegistration('raisonSociale', e.target.value)
                      }
                      placeholder={isAr ? 'مثال: شركة...' : 'ex: Societe...'}
                      className="h-12 rounded-xl"
                    />
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-xs font-bold text-muted-foreground">
                    {isAr ? 'الماركة' : 'Marque'}
                    <span className="text-destructive"> *</span>
                  </label>
                  <Input
                    value={vehicleRegistration.marque}
                    onChange={(e) => updateVehicleRegistration('marque', e.target.value)}
                    placeholder={isAr ? 'مثال: TVS, Bajaj' : 'ex: TVS, Bajaj'}
                    className="h-12 rounded-xl"
                    dir="ltr"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-muted-foreground">
                    {isAr ? 'نوع المركبة' : 'Type de vehicule'}
                    <span className="text-[10px] font-normal text-muted-foreground">
                      {' '}
                      ({isAr ? 'اختياري' : 'optionnel'})
                    </span>
                  </label>
                  <Input
                    value={vehicleRegistration.type}
                    onChange={(e) => updateVehicleRegistration('type', e.target.value)}
                    placeholder={isAr ? 'مثال: Triporteur' : 'ex: Triporteur'}
                    className="h-12 rounded-xl"
                    dir="ltr"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-muted-foreground">
                    {isAr ? 'سنة أول ضخ في الخدمة' : 'Annee de mise en circulation'}
                    <span className="text-destructive"> *</span>
                  </label>
                  <Input
                    type="number"
                    min={1950}
                    max={new Date().getFullYear() + 1}
                    value={vehicleRegistration.anneePremiereMiseCirculation}
                    onChange={(e) =>
                      updateVehicleRegistration('anneePremiereMiseCirculation', e.target.value)
                    }
                    className="h-12 rounded-xl"
                    dir="ltr"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-muted-foreground">
                    {t.firstCirculationDate}
                    <span className="text-destructive"> *</span>
                  </label>
                  <Input
                    type="date"
                    value={vehicleRegistration.datePremiereMiseEnCirculation}
                    onChange={(e) =>
                      updateVehicleRegistration('datePremiereMiseEnCirculation', e.target.value)
                    }
                    className="h-12 rounded-xl"
                    dir="ltr"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-muted-foreground">
                    {t.address}
                    <span className="text-destructive"> *</span>
                  </label>
                  <Input
                    value={vehicleRegistration.adresse}
                    onChange={(e) => updateVehicleRegistration('adresse', e.target.value)}
                    placeholder={isAr ? 'مثال: القرارة - غرداية' : 'ex: El Guerrara - Ghardaia'}
                    className="h-12 rounded-xl"
                  />
                </div>


                <div>
                  <label className="mb-1 block text-xs font-bold text-muted-foreground">
                    {t.driverService}
                    <span className="text-destructive"> *</span>
                  </label>
                  <Select
                    value={vehicleRegistration.serviceType}
                    onValueChange={(v) =>
                      updateVehicleRegistration(
                        "serviceType",
                        v as "CARGO" | "TAXI" | "BOTH"
                      )
                    }
                  >
                    <SelectTrigger className="h-12 rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CARGO">{t.cargoService}</SelectItem>
                      <SelectItem value="TAXI">{t.taxiService}</SelectItem>
                      <SelectItem value="BOTH">{t.bothServices}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {vehicleRegistration.serviceType !== "TAXI" ? (
                  <div>
                    <label className="mb-1 block text-xs font-bold text-muted-foreground">
                      {t.cargoCapacity}
                      <span className="text-[10px] font-normal text-muted-foreground"> ({isAr ? "· اختياري" : "· optionnel"})</span>
                    </label>
                    <Input
                      value={vehicleRegistration.ptac}
                      onChange={(e) => updateVehicleRegistration("ptac", e.target.value)}
                      placeholder={isAr ? "الحمولة الإجمالية بالكيلوغرام" : "Capacite de chargement (kg)"}
                      className="h-12 rounded-xl"
                      dir="ltr"
                    />
                  </div>
                ) : null}

                {vehicleRegistration.serviceType !== "CARGO" ? (
                  <div>
                    <label className="mb-1 block text-xs font-bold text-muted-foreground">
                      {t.seatsNumber}
                      <span className="text-destructive"> *</span>
                    </label>
                    <Input
                      type="number"
                      min={1}
                      max={30}
                      value={vehicleRegistration.seats}
                      onChange={(e) => updateVehicleRegistration("seats", e.target.value)}
                      placeholder={isAr ? "عدد المقاعد (1-30)" : "Nombre de places (1-30)"}
                      className="h-12 rounded-xl"
                      dir="ltr"
                    />
                  </div>
                ) : null}


              </div>
            </div>
          </div>
          <Button
            onClick={handleApplyDriver}
            disabled={loading}
            size="lg"
            className="mt-6 h-12 w-full rounded-xl bg-primary text-sm font-bold shadow-lg"
          >
            {loading ? <Sparkles className="animate-spin" size={18} /> : null}
            {isAr ? 'إرسال الطلب' : 'Envoyer la demande'}
          </Button>
          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            {isAr
              ? `رقم الهاتف المستخدم: +213 ${phone}`
              : `Numéro utilisé: +213 ${phone}`}
          </p>
        </div>
      </div>
    );
  }

  if (step === 'driver-pending') {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <div className="flex items-center justify-between p-5">
          <button
            onClick={() => {
              setStep('phone');
              setOtp('');
              setName('');
              setPassword('');
              setConfirmPassword('');
              setEmail('');
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-sm"
          >
            {isAr ? <ArrowRight size={20} /> : <ArrowLeft size={20} />}
          </button>
          <LangToggle />
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-6 pb-8 text-center">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-950/40">
            <ShieldCheck size={40} className="text-amber-600" />
          </div>
          <h2 className="text-2xl font-black text-foreground">
            {isAr ? 'طلبك قيد المراجعة' : 'Demande en cours de revue'}
          </h2>
          <p className="mt-3 max-w-sm text-sm text-muted-foreground">
            {isAr
              ? 'تم استلام طلب التسجيل بنجاح. سيتم إبلاغك عاجلاً حين يراجع المدير المعلومات.'
              : 'Votre demande d\u2019inscription a bien été reçue. Vous serez notifié dès que l\u2019administrateur l\u2019aura passée en revue.'}
          </p>
          <Button
            onClick={() => {
              setStep('phone');
              setOtp('');
              setName('');
            }}
            variant="outline"
            className="mt-6 h-11 rounded-xl"
          >
            {isAr ? 'الرجوع' : 'Retour'}
          </Button>
        </div>
      </div>
    );
  }

  if (step === 'driver-rejected') {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <div className="flex items-center justify-between p-5">
          <button
            onClick={() => {
              setStep('phone');
              setOtp('');
              setName('');
              setPassword('');
              setConfirmPassword('');
              setEmail('');
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-sm"
          >
            {isAr ? <ArrowRight size={20} /> : <ArrowLeft size={20} />}
          </button>
          <LangToggle />
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-6 pb-8 text-center">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-red-100 dark:bg-red-950/40">
            <ShieldCheck size={40} className="text-red-600" />
          </div>
          <h2 className="text-2xl font-black text-foreground">
            {isAr ? 'تم رفض الطلب' : 'Demande refusée'}
          </h2>
          <p className="mt-3 max-w-sm text-sm text-muted-foreground">
            {isAr
              ? 'لم يتم الموافقة على طلبك. يمكنك إعادة التقديم بعد تحسين المعلومات.'
              : 'Votre demande n\u2019a pas été acceptée. Vous pouvez resoumettre après avoir corrigé les informations.'}
          </p>
          <Button
            onClick={() => {
              setStep('driver-form');
            }}
            className="mt-6 h-11 rounded-xl"
          >
            {isAr ? 'إعادة التقديم' : 'Resoumettre'}
          </Button>
          <Button
            onClick={() => {
              setStep('phone');
              setOtp('');
              setName('');
            }}
            variant="ghost"
            className="mt-2 h-11 rounded-xl"
          >
            {isAr ? 'الرجوع' : 'Retour'}
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

function FeaturePill({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 backdrop-blur">
      <Icon size={13} />
      <span className="text-xs font-semibold">
        {label}
      </span>
    </div>
  );
}

function DemoBtn({
  icon: Icon,
  label,
  onClick,
  loading,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  onClick: () => void;
  loading: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={cn(
        'flex flex-col items-center gap-1.5 rounded-xl bg-white/10 px-2 py-3 backdrop-blur transition hover:bg-white/20 disabled:opacity-50'
      )}
    >
      <Icon size={18} />

      <span className="text-[11px] font-bold">
        {label}
      </span>
    </button>
  );
}
