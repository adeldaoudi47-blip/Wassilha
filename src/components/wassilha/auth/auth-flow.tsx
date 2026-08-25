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

type Step = 'onboarding' | 'phone' | 'otp' | 'signup' | 'login';

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
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);

  const Arrow = isAr ? ArrowLeft : ArrowRight;

  useEffect(() => {
    api.pendingSignup()
      .then(({ pendingSignup, phone: verifiedPhone }) => {
        if (pendingSignup && verifiedPhone) {
          setPhone(verifiedPhone);
          setStep('signup');
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
    // SECURITY + UX: single normalizer shared with the API — accepts local,
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

      toast.error(
        isAr
          ? 'تعذر إرسال رمز التحقق. حاول مرة أخرى.'
          : 'Impossible d’envoyer le code. Réessayez.'
      );
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
        setStep('signup');
        return;
      }

      if (!result.user) throw new Error('Authenticated user missing');
      setUser(result.user);

      toast.success(
        isAr
          ? `أهلًا ${result.user.name ?? ''}`
          : `Bienvenue ${result.user.name ?? ''}`
      );
    } catch (error) {
      console.error('VERIFY OTP ERROR:', error);

      toast.error(
        isAr
          ? 'رمز التحقق غير صحيح أو انتهت صلاحيته'
          : 'Code incorrect ou expiré'
      );
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
      toast.error(isAr ? 'تعذر إنشاء الحساب. تحقق من البيانات.' : 'Impossible de créer le compte. Vérifiez vos données.');
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
      toast.success(isAr ? `أهلًا ${user.name}` : `Bienvenue ${user.name}`);
    } catch (error) {
      console.error('EMAIL LOGIN ERROR:', error);
      toast.error(isAr ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة' : 'Email ou mot de passe incorrect');
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
          ? `أهلًا ${user.name}`
          : `Bienvenue ${user.name}`
      );
    } catch (error) {
      console.error('QUICK LOGIN ERROR:', error);

      toast.error(
        isAr
          ? 'فشل تسجيل الدخول'
          : 'Échec de connexion'
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
            {t.appSub} · TRI PORTEUR
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
            {t.welcome} — {t.tagline}
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
          </div>

          <div className="mt-auto pb-6 pt-8">
            <div className="flex items-center justify-center gap-2 rounded-xl bg-muted/50 p-3 text-center text-xs text-muted-foreground">
              <ShieldCheck
                size={14}
                className="text-primary"
              />

              {t.securedBy} ·{' '}
              {isAr
                ? 'رمز تحقق آمن'
                : 'Code de vérification sécurisé'}
            </div>
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
            {isAr ? 'تم التحقق من رقم هاتفك بنجاح. أكمل بياناتك لإنشاء حسابك في وصلها.' : 'Votre téléphone est vérifié. Complétez vos informations pour créer votre compte.'}
          </p>
          <div className="mt-5 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" dir="ltr">
            ✓ {phone} - {isAr ? 'رقم الهاتف مؤكد' : 'Téléphone confirmé'}
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
              {Array.from({
                length: OTP_LENGTH,
              }).map((_, index) => (
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