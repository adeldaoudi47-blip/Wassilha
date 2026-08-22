'use client';

import { useState, useEffect, useRef } from 'react';
import { Phone, ArrowLeft, ArrowRight, ShieldCheck, Headphones, Bike, Package, Sparkles } from 'lucide-react';
import { BrandLogo } from '../brand-logo';
import { LangToggle } from '../lang-toggle';
import { useT } from '../use-t';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { cn } from '@/lib/utils';
import type { Role } from '@/lib/types';

type Step = 'onboarding' | 'phone' | 'otp';

export function AuthFlow() {
  const { t, isAr, isRtl } = useT();
  const setUser = useAppStore((s) => s.setUser);
  const [step, setStep] = useState<Step>('onboarding');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const Arrow = isAr ? ArrowLeft : ArrowRight;

  useEffect(() => {
    if (resendTimer <= 0) return;
    const id = setTimeout(() => setResendTimer((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendTimer]);

  const validatePhone = (p: string) => /^0[567]\d{8}$/.test(p.replace(/\s/g, ''));

  const handleSendOtp = async () => {
    const clean = phone.replace(/\s/g, '');
    if (!validatePhone(clean)) {
      toast.error(t.invalidPhone);
      return;
    }
    setLoading(true);
    try {
      await api.sendOtp(clean);
      setPhone(clean);
      setStep('otp');
      setResendTimer(30);
      toast.success(isAr ? `الرمز التجريبي: 0000` : 'Code démo: 0000');
    } catch {
      toast.error(isAr ? 'خطأ في الإرسال' : 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (otp.length < 4) {
      toast.error(t.invalidOtp);
      return;
    }
    setLoading(true);
    try {
      const { user } = await api.verifyOtp(phone, otp, name || undefined);
      setUser(user);
      toast.success(isAr ? `أهلاً ${user.name}` : `Bienvenue ${user.name}`);
    } catch {
      toast.error(t.invalidOtp);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = async (role: Role) => {
    setLoading(true);
    try {
      const { user } = await api.loginAs(role);
      setUser(user);
      toast.success(isAr ? `أهلاً ${user.name}` : `Bienvenue ${user.name}`);
    } catch {
      toast.error(isAr ? 'فشل الدخول' : 'Échec');
    } finally {
      setLoading(false);
    }
  };

  // ===== ONBOARDING =====
  if (step === 'onboarding') {
    return (
      <div className="relative flex min-h-screen flex-col overflow-hidden bg-primary text-white">
        {/* Decorative circles */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -left-20 top-1/2 h-72 w-72 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute bottom-0 right-1/4 h-64 w-64 rounded-full bg-[#FF7A00]/10" />

        {/* Top bar */}
        <div className="relative z-10 flex items-center justify-between p-5">
          <div className="flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 backdrop-blur">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-300" />
            <span className="text-xs font-semibold">{t.location}</span>
          </div>
          <LangToggle variant="ghost" />
        </div>

        {/* Hero */}
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="animate-float mb-8">
            <div className="flex h-28 w-28 items-center justify-center rounded-[2rem] bg-white shadow-2xl">
              <BrandLogo size={72} />
            </div>
          </div>
          <h1 className="text-5xl font-black tracking-tight">{t.appName}</h1>
          <p className="mt-1 text-sm font-bold uppercase tracking-[0.3em] text-white/70">{t.appSub} · TRI PORTEUR</p>
          <p className="mt-5 max-w-sm text-balance text-base text-white/85">{t.welcomeSub}</p>

          {/* Feature pills */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
            <FeaturePill icon={ShieldCheck} label={t.securedBy} />
            <FeaturePill icon={Headphones} label={t.support24} />
            <FeaturePill icon={Bike} label={t.realtimeActive} />
          </div>
        </div>

        {/* CTA */}
        <div className="relative z-10 space-y-3 px-6 pb-10 pt-4">
          <Button
            onClick={() => setStep('phone')}
            size="lg"
            className="h-14 w-full rounded-2xl bg-white text-base font-bold text-primary shadow-xl hover:bg-white/90"
          >
            <Phone size={20} className="me-2" />
            {t.startNow}
          </Button>

          {/* Quick demo logins */}
          <div className="pt-2">
            <p className="mb-2 text-center text-xs font-medium text-white/60">{t.pickRole}</p>
            <div className="grid grid-cols-3 gap-2">
              <DemoBtn icon={Package} label={t.customer} onClick={() => handleQuickLogin('customer')} loading={loading} />
              <DemoBtn icon={Bike} label={t.driver} onClick={() => handleQuickLogin('driver')} loading={loading} />
              <DemoBtn icon={ShieldCheck} label={t.admin} onClick={() => handleQuickLogin('admin')} loading={loading} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ===== PHONE =====
  if (step === 'phone') {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <div className="flex items-center justify-between p-5">
          <button onClick={() => setStep('onboarding')} className="flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-sm">
            {isAr ? <ArrowRight size={20} /> : <ArrowLeft size={20} />}
          </button>
          <LangToggle />
        </div>
        <div className="flex flex-1 flex-col px-6">
          <div className="mb-8 mt-4">
            <BrandLogo size={56} showText />
          </div>
          <h2 className="text-2xl font-black text-foreground">{t.phoneLogin}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t.welcome} — {t.tagline}</p>

          <div className="mt-8 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">{t.phoneHint}</label>
              <div className="flex items-center gap-2">
                <div className="flex h-12 items-center gap-1.5 rounded-xl border border-border bg-card px-3">
                  <span className="text-lg">🇩🇿</span>
                  <span className="text-sm font-bold text-foreground" dir="ltr">+213</span>
                </div>
                <Input
                  dir="ltr"
                  inputMode="tel"
                  placeholder={t.phonePlaceholder}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-12 flex-1 text-start font-semibold tracking-wide"
                  onKeyDown={(e) => e.key === 'Enter' && handleSendOtp()}
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">{t.name} ({t.customer})</label>
              <Input
                placeholder={isAr ? 'اسمك (اختياري)' : 'Votre nom (optionnel)'}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-12"
              />
            </div>

            <Button
              onClick={handleSendOtp}
              disabled={loading}
              size="lg"
              className="h-12 w-full rounded-xl bg-primary text-sm font-bold shadow-lg"
            >
              {loading ? <Sparkles className="animate-spin" size={18} /> : <Phone size={18} className="me-2" />}
              {t.sendOTP}
            </Button>
          </div>

          <div className="mt-auto pb-6 pt-8">
            <div className="flex items-center justify-center gap-2 rounded-xl bg-muted/50 p-3 text-center text-xs text-muted-foreground">
              <ShieldCheck size={14} className="text-primary" />
              {t.securedBy} · {t.otpHint}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ===== OTP =====
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex items-center justify-between p-5">
        <button onClick={() => setStep('phone')} className="flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-sm">
          {isAr ? <ArrowRight size={20} /> : <ArrowLeft size={20} />}
        </button>
        <LangToggle />
      </div>
      <div className="flex flex-1 flex-col px-6">
        <div className="mb-8 mt-4">
          <BrandLogo size={56} showText />
        </div>
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <ShieldCheck size={30} className="text-primary" />
        </div>
        <h2 className="text-2xl font-black text-foreground">{t.otpTitle}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t.otpSub} <span dir="ltr" className="font-bold text-foreground">+213 {phone}</span>
        </p>

        <div className="mt-8 flex justify-center" dir="ltr">
          <InputOTP maxLength={4} value={otp} onChange={setOtp}>
            <InputOTPGroup className="gap-3">
              <InputOTPSlot index={0} className="h-14 w-12 rounded-xl border-2 text-xl font-bold" />
              <InputOTPSlot index={1} className="h-14 w-12 rounded-xl border-2 text-xl font-bold" />
              <InputOTPSlot index={2} className="h-14 w-12 rounded-xl border-2 text-xl font-bold" />
              <InputOTPSlot index={3} className="h-14 w-12 rounded-xl border-2 text-xl font-bold" />
            </InputOTPGroup>
          </InputOTP>
        </div>

        <Button
          onClick={handleVerify}
          disabled={loading || otp.length < 4}
          size="lg"
          className="mt-8 h-12 w-full rounded-xl bg-primary text-sm font-bold shadow-lg"
        >
          {loading ? <Sparkles className="animate-spin" size={18} /> : null}
          {t.verify}
        </Button>

        <div className="mt-4 text-center">
          {resendTimer > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t.resendIn} {resendTimer} {t.seconds}
            </p>
          ) : (
            <button onClick={handleSendOtp} className="text-xs font-bold text-primary hover:underline">
              {t.resend}
            </button>
          )}
        </div>

        <div className="mt-auto pb-6 pt-8">
          <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 p-3 text-center text-xs text-amber-700 dark:text-amber-300">
            {t.otpHint}
          </div>
        </div>
      </div>
    </div>
  );
}

function FeaturePill({ icon: Icon, label }: { icon: React.ComponentType<{ size?: number }>; label: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 backdrop-blur">
      <Icon size={13} />
      <span className="text-xs font-semibold">{label}</span>
    </div>
  );
}

function DemoBtn({ icon: Icon, label, onClick, loading }: { icon: React.ComponentType<{ size?: number }>; label: string; onClick: () => void; loading: boolean }) {
  const { isAr } = useT();
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={cn(
        'flex flex-col items-center gap-1.5 rounded-xl bg-white/10 px-2 py-3 backdrop-blur transition hover:bg-white/20 disabled:opacity-50'
      )}
    >
      <Icon size={18} />
      <span className="text-[11px] font-bold">{label}</span>
    </button>
  );
}
