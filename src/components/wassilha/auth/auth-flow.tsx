'use client';

import { useState, useEffect } from 'react';
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
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp';
import { cn } from '@/lib/utils';
import type { Role } from '@/lib/types';
import { normalizeAlgerianPhone } from '@/lib/phone';

type Step = 'onboarding' | 'phone' | 'otp' | 'signup' | 'login' | 'forgot-phone' | 'forgot-otp' | 'forgot-reset' | 'driver-form' | 'driver-pending' | 'driver-rejected';

const OTP_DEMO_MODE =
  process.env.NEXT_PUBLIC_OTP_DEMO_MODE === 'true';

const OTP_LENGTH = OTP_DEMO_MODE ? 4 : 6;

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
  const [resendTimer, setResendTimer] = useState(0);
  // When true, the user came from "Devenir chauffeur" and should be
  // routed to the driver form on a fresh account instead of customer signup.
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
          // FIX: a previously-saved driver intent should never bleed
          // into a recovered customer signup. Clear the flag whenever
          // we auto-restore a pending signup.
          setIntendsDriver(false);
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

      if (OTP_DEMO_MODE) {
        toast.success(
          isAr
            ? `رمز التجربة: ${result.devOtp || '0000'}`
            : `Code démo : ${result.devOtp || '0000'}`
        );
      } else {
        toast.success(
          isAr
            ? 'تم إرسال رمز التحقق إلى هاتفك'
            : 'Le code de vérification a été envoyé à votre téléphone'
        );
      }
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
      toast.error(
        isAr
          ? 'أدخل رقم هاتف جزائري صحيح'
          : 'Entrez un numéro de téléphone algérien valide'
      );
      return;
    }
    setLoading(true);
    // FIX: move the name-clearing *inside* this handler so it always
    // happens (regardless of which UI entry point calls it) and so the
    // customer name is never silently wiped from the wrong flow.
    setName('');
    setIntendsDriver(true);
    try {
      const result = await api.sendOtp(clean);
      setPhone(clean);
      setOtp('');
      setStep('otp');
      setResendTimer(30);
      if (OTP_DEMO_MODE) {
        toast.success(
          isAr
            ? `رمز التجربة: ${result.devOtp || '0000'}`
            : `Code démo : ${result.devOtp || '0000'}`
        );
      }
    } catch (error) {
      console.error('SEND OTP (DRIVER) ERROR:', error);
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
      toast.error(isAr ? ar : fr);
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

    setLoading(true);

    try {
      const result = await api.verifyOtp(
        phone,
        otp,
        name || undefined
      );

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
        if (intendsDriver) {
          setStep('driver-form');
        } else {
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
    setLoading(true);
    try {
      await api.applyDriver({
        name: name.trim(),
        numeroImmatriculation: vr.numeroImmatriculation.trim(),
        typeProprietaire: vr.typeProprietaire,
        nom: vr.typeProprietaire === 'PERSONNE_PHYSIQUE' ? vr.nom.trim() : undefined,
        prenom: vr.typeProprietaire === 'PERSONNE_PHYSIQUE' ? vr.prenom.trim() : undefined,
        raisonSociale: vr.typeProprietaire === 'PERSONNE_MORALE' ? vr.raisonSociale.trim() : undefined,
        marque: vr.marque.trim(),
        type: vr.type.trim() || undefined,
        anneePremiereMiseCirculation: year,
      });
      toast.success(
        isAr
          ? 'أرسل طلبك. سيتم المراجعة من طرف المدير.'
          : 'Demande envoyée. L\u2019administrateur va la passer en revue.'
      );
      setStep('driver-pending');
    } catch (error) {
      console.error('APPLY DRIVER ERROR:', error);
      const msg = error instanceof Error ? error.message : '';
      toast.error(
        msg ||
          (isAr
            ? 'تعذّر إرسال الطلب. حاول مرة أخرى.'
            : 'Impossible d\u2019envoyer la demande. Réessayez.')
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
      if (OTP_DEMO_MODE) toast.success('Demo code: ' + (result.devOtp || '0000'));
      else toast.success(isAr ? 'Code sent' : 'Code envoye');
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
    setLoading(true);
    try {
      const result = await api.verifyOtp(forgotPhone, otp);
      if (result.requiresSignup) {
        toast.error(isAr ? 'Account not found' : 'Compte non trouve');
        return;
      }
      if (!result.user) throw new Error('Missing user');
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

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                {t.name} ({t.customer})
              </label>

              <Input
                placeholder={
                  isAr
                    ? 'اسمك (اختياري)'
                    : 'Votre nom (optionnel)'
                }
                value={name}
                onChange={(e) =>
                  setName(e.target.value)
                }
                className="h-12"
              />
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

            <div className="mt-4 flex items-center gap-3 text-[11px] text-muted-foreground">
              <div className="h-px flex-1 bg-border" />
              <span>{isAr ? 'أو' : 'OU'}</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <button
              type="button"
              onClick={async () => {
                // Driver flow: send the OTP just like the customer flow, then
                // once verified, the server will route the user to the driver
                // form (since role=driver + accountStatus=pending drivers
                // don't get a session and surface the "pending" state).
                // setName('') is now handled inside handleSendOtpAsDriver
                // so any future entry point gets the same cleanup.
                await handleSendOtpAsDriver();
              }}
              disabled={loading}
              className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-primary bg-primary/5 text-sm font-bold text-primary shadow-sm transition-colors hover:bg-primary/10 disabled:opacity-50"
            >
              <Bike size={18} className="shrink-0" />
              {isAr ? 'أريد التسجيل كسائق' : 'Devenir chauffeur'}
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
          <Button onClick={handleVerifyForgotOtp} disabled={loading || otp.length !== OTP_LENGTH} size="lg" className="mt-8 h-12 w-full rounded-xl bg-primary text-sm font-bold shadow-lg">
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
              {OTP_DEMO_MODE
                ? isAr
                  ? 'وضع التجربة: استخدم 0000'
                  : 'Mode demo : utilisez 0000'
                : isAr
                  ? 'أدخل الرمز المكون من 6 أرقام المرسل عبر SMS'
                  : 'Entrez le code a 6 chiffres recu par SMS'}
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

        {intendsDriver && (
          <div
            className="mb-4 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-bold text-primary"
            role="status"
          >
            <Bike size={14} className="shrink-0" />
            {isAr
              ? 'مسار التسجيل كسائق'
              : 'Inscription en tant que chauffeur'}
          </div>
        )}

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

        <Button
          onClick={handleVerify}
          disabled={
            loading || otp.length !== OTP_LENGTH
          }
          size="lg"
          className="mt-8 h-12 w-full rounded-xl bg-primary text-sm font-bold shadow-lg"
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
              onClick={handleSendOtp}
              className="text-xs font-bold text-primary hover:underline"
            >
              {t.resend}
            </button>
          )}
        </div>

        <div className="mt-auto pb-6 pt-8">
          <div className="rounded-xl bg-amber-50 p-3 text-center text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
            {OTP_DEMO_MODE
              ? isAr
                ? 'وضع التجربة: استخدم 0000'
                : 'Mode démo : utilisez 0000'
              : isAr
                ? 'أدخل الرمز المكون من 6 أرقام المرسل عبر SMS'
                : 'Entrez le code à 6 chiffres reçu par SMS'}
          </div>
        </div>
      </div>
    </div>
  );

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
                    placeholder={isAr ? 'مثال: 2021' : 'ex: 2021'}
                    className="h-12 rounded-xl"
                    dir="ltr"
                  />
                </div>
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
