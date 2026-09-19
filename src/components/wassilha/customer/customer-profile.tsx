'use client';

import { Phone, MapPin, Clock, ShieldCheck, Headphones, Bike, Package, Layers, Hammer, ArrowLeftRight, User, Camera, Sparkles } from 'lucide-react';
import { useT } from '../use-t';
import { useAppStore } from '@/lib/store';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { BrandLogo } from '../brand-logo';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useEffect, useState } from 'react';
import { UpgradeDriverDialog } from './upgrade-driver-dialog';
import { ApplyArtisanDialog } from './apply-artisan-dialog';
import type { Order } from '@/lib/types';
import { formatDzd } from '@/lib/wassilha-data';
import Link from 'next/link';

export function CustomerProfile() {
  const { t, isAr } = useT();
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);
  const viewMode = useAppStore((s) => s.viewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const [orders, setOrders] = useState<Order[]>([]);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showArtisanApply, setShowArtisanApply] = useState(false);

  useEffect(() => {
    api.listOrders({ role: 'customer' }).then(setOrders).catch(() => {});
  }, []);

  const stats = {
    total: orders.length,
    delivered: orders.filter((o) => o.status === 'delivered').length,
    spent: orders.filter((o) => o.status === 'delivered').reduce((s, o) => s + o.price, 0),
  };

  const handleLogout = async () => {
    try { await api.logout(); } catch { /* ignore */ }
    setUser(null);
  };

  // OPTIONAL PROFILE COMPLETION state: a customer created via the OTP
  // auto-create flow starts with an empty name + no avatar, so this tab is
  // where they fill those in (and edit them later). Nothing is required to
  // use the app — these fields are purely optional.
  const [profileName, setProfileName] = useState(user?.name ?? '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  // Keep the input in sync whenever the session user changes (e.g. right
  // after login, or after another tab saved the profile).
  useEffect(() => {
    setProfileName(user?.name ?? '');
  }, [user?.name]);

  // Revoke the previous local object URL on every re-pick so the preview
  // never leaks a blob reference.
  const handlePickAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setAvatarFile(file);
    setAvatarPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    const trimmed = profileName.trim();
    if (trimmed.length > 50) {
      toast.error(isAr ? 'الاسم طويل جداً (50 حرفاً كحد أقصى)' : 'Nom trop long (50 max)');
      return;
    }
    if (!trimmed && !avatarFile) {
      toast.error(isAr ? 'أدخل اسماً أو اختر صورة' : 'Saisissez un nom ou une image');
      return;
    }
    setSavingProfile(true);
    try {
      const fd = new FormData();
      fd.append('name', trimmed);
      if (avatarFile) fd.append('avatar', avatarFile);
      const { user: updated } = await api.updateMe(fd);
      setUser(updated);
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setAvatarFile(null);
      setAvatarPreview(null);
      toast.success(isAr ? 'تم حفظ ملفك الشخصي' : 'Profil enregistré');
    } catch {
      toast.error(isAr ? 'تعذر حفظ الملف الشخصي' : "Échec de l'enregistrement");
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Profile header */}
      <Card className="overflow-hidden p-0">
        <div className="bg-gradient-to-br from-primary to-brand-dark p-5 text-primary-foreground">
          <div className="flex items-center gap-3">
            {user?.avatar ? (
              <img
                src={user.avatar}
                alt=""
                className="h-16 w-16 rounded-2xl object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
                {user?.name ? (
                  <span className="text-2xl font-black">
                    {user.name.charAt(0).toUpperCase()}
                  </span>
                ) : (
                  <User size={26} />
                )}
              </div>
            )}
            <div>
              <p className="text-lg font-bold">
                {user?.name || (isAr ? 'زبون جديد' : 'Nouveau client')}
              </p>
              <p className="flex items-center gap-1.5 text-sm text-primary-foreground/80" dir="ltr">
                <Phone size={12} /> +213 {user?.phone}
              </p>
              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold backdrop-blur">
                <ShieldCheck size={10} /> {t.customer}
              </span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-x-reverse divide-border">
          <Stat label={t.totalOrders} value={String(stats.total)} />
          <Stat label={t.deliveredOrders} value={String(stats.delivered)} />
          <Stat label={t.revenue} value={`${formatDzd(stats.spent)}`} suffix={t.dzd} />
        </div>
      </Card>

      {/* OPTIONAL PROFILE COMPLETION (and later edits): a customer is
          auto-created with an empty name, so a fresh user gets a gentle
          nudge here. The same card lets any user change their name and
          avatar at any time — nothing is required to use the app. */}
      <Card className="p-4">
        {!user?.name && (
          <div className="mb-3 rounded-xl bg-amber-50 p-2.5 text-center text-xs font-bold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
            {isAr ? 'أكمل ملفك الشخصي' : 'Complétez votre profil'}
          </div>
        )}
        <div className="flex items-center gap-3">
          <label className="relative shrink-0 cursor-pointer">
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={handlePickAvatar}
            />
            {avatarPreview ? (
              <img src={avatarPreview} alt="" className="h-14 w-14 rounded-full object-cover" />
            ) : user?.avatar ? (
              <img src={user.avatar} alt="" className="h-14 w-14 rounded-full object-cover" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <Camera size={20} className="text-muted-foreground" />
              </div>
            )}
          </label>
          <Input
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            placeholder={isAr ? 'الاسم (اختياري)' : 'Nom (facultatif)'}
            maxLength={50}
            className="flex-1"
          />
          <Button
            onClick={handleSaveProfile}
            disabled={savingProfile}
            className="shrink-0"
            size="sm"
          >
            {savingProfile ? (
              <Sparkles className="animate-spin" size={16} />
            ) : isAr ? (
              'حفظ'
            ) : (
              'Enregistrer'
            )}
          </Button>
        </div>
      </Card>

      {/* Info rows */}
      <Card className="divide-y divide-border p-0">
        <InfoRow icon={<MapPin size={16} className="text-primary" />} label={t.location} value={t.location} />
        <InfoRow icon={<Clock size={16} className="text-sky-500" />} label={t.algeriaTime} value="UTC+1" />
        <InfoRow icon={<Headphones size={16} className="text-emerald-500" />} label={t.support24} value="7/7" />
      </Card>

      {/* Tech / about */}
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <BrandLogo size={28} />
          <div>
            <p className="text-sm font-bold text-foreground">{t.appName} · {t.appSub}</p>
            <p className="text-[11px] text-muted-foreground">{t.tagline}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {['Next.js 16', 'Prisma', 'Socket.IO', 'TypeScript', 'Tailwind'].map((tech) => (
            <span key={tech} className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {tech}
            </span>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          {isAr
            ? 'منصة النقل المحلية بالدراجة ثلاثية العجلات لنقل كل أنواع البضائع في القرارة - غرداية. مبنية بمعمارية إنتاج حقيقية مع قاعدة بيانات وزمن حقيقي.'
            : 'Plateforme locale de transport triporteur pour toutes vos marchandises à El Guerrara. Architecture de production avec base de données et temps réel.'}
        </p>
      </Card>

            {/* UPGRADE_TO_DRIVER_BLOCK — Inline card that links a logged-in
          customer into the "Devenir chauffeur" modal. The full upgrade
          flow (form, validation, API call, session revocation, logout
          + fall-through to auth flow) lives in
          ./upgrade-driver-dialog.tsx. */}
      {/* UPGRADE_VISIBILITY_V2: high-contrast amber call-out so the
          upgrade CTA reads as a primary action, not as decoration. */}
      <Card className="overflow-hidden border-2 border-amber-300 bg-amber-50 p-4 shadow-md dark:border-amber-700 dark:bg-amber-950/20">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-200 text-amber-900 shadow-sm dark:bg-amber-900/30 dark:text-amber-200">
            <Bike size={22} />
          </div>
          <div className="flex-1">
            <p className="text-base font-black text-amber-900 dark:text-amber-200">
              {isAr ? 'أصبح سائقاً' : 'Devenir chauffeur'}
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-amber-800/90 dark:text-amber-300/80">
              {isAr
                ? 'استخدم حسابك الحالي للتقديم كسائق. سيتم مراجعة طلبك من طرف المدير قبل التفعيل.'
                : 'Utilisez votre compte actuel pour postuler comme chauffeur. Votre demande sera revue par l’administrateur avant activation.'}
            </p>
            <Button
              onClick={() => setShowUpgrade(true)}
              className="mt-4 h-12 w-full rounded-xl bg-amber-500 text-sm font-black uppercase tracking-wide text-white shadow-lg hover:bg-amber-600 dark:bg-amber-500 dark:hover:bg-amber-400"
              size="lg"
            >
              {isAr ? 'تقديم طلب / Postuler' : 'Postuler'}
            </Button>
          </div>
        </div>
      </Card>

      {/* HIRFA (P4): artisan store application call-out. Mirrors the
          upgrade-to-driver amber card but in HIRFA emerald branding. */}
      <Card className="overflow-hidden border-2 border-emerald-300 bg-emerald-50 p-4 shadow-md dark:border-emerald-700 dark:bg-emerald-950/20">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-200 text-emerald-900 shadow-sm dark:bg-emerald-900/30 dark:text-emerald-200">
            <Hammer size={22} />
          </div>
          <div className="flex-1">
            <p className="text-base font-black text-emerald-900 dark:text-emerald-200">
              {t.openCraftStore}
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-emerald-800/90 dark:text-emerald-300/80">
              {t.openCraftStoreSub}
            </p>
            <Button
              onClick={() => setShowArtisanApply(true)}
              className="mt-4 h-12 w-full rounded-xl bg-emerald-600 text-sm font-black uppercase tracking-wide text-white shadow-lg hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              size="lg"
            >
              {t.applyAsArtisan}
            </Button>
          </div>
        </div>
      </Card>

      {showArtisanApply && (
        <ApplyArtisanDialog onClose={() => setShowArtisanApply(false)} />
      )}

      {showUpgrade && (
        <UpgradeDriverDialog
          isAr={isAr}
          onClose={() => setShowUpgrade(false)}
          onSuccess={() => {
            setShowUpgrade(false);
            setUser(null);
          }}
        />
      )}

      {/* ROLE VIEW SWITCH (return path): shown only when a driver/artisan
          is browsing in customer mode (viewMode === 'customer'). Tapping it
          restores their real dashboard — no DB role change involved. */}
      {viewMode === 'customer' && user && (user.role === 'driver' || user.role === 'artisan') && (
        <Button
          onClick={() => setViewMode('default')}
          className="w-full bg-primary text-primary-foreground hover:bg-brand-dark"
        >
          <ArrowLeftRight size={16} className="me-2" />
          {user.role === 'driver' ? t.switchToDriver : t.switchToArtisan}
        </Button>
      )}

<Button onClick={handleLogout} variant="outline" className="w-full border-destructive text-destructive hover:bg-destructive/5">
        {t.logout}
      </Button>

      <div className="text-center">
        <Link
          href="/privacy-policy"
          className="text-[11px] font-semibold text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
        >
          سياسة الخصوصية · Politique de confidentialité
        </Link>
      </div>

      <p className="text-center text-[10px] text-muted-foreground">
        {t.appName} v1.0.0 · {t.location} · © 2026
      </p>
    </div>
  );
}

function Stat({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="p-3 text-center">
      <p className="text-lg font-black text-primary">{value}</p>
      <p className="text-[10px] font-semibold text-muted-foreground">
        {label}{suffix ? ` (${suffix})` : ''}
      </p>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 p-3.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">{icon}</div>
      <span className="text-sm font-semibold text-muted-foreground">{label}</span>
      <span className="ms-auto text-sm font-bold text-foreground">{value}</span>
    </div>
  );
}
