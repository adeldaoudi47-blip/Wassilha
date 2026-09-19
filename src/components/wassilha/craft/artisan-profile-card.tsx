'use client';

import { useEffect, useState } from 'react';
import {
  Camera,
  Check,
  ExternalLink,
  Link2,
  Loader2,
  Package,
  Pencil,
  Store,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useT } from '../use-t';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getMarketplaceT } from '@/lib/marketplace-i18n';
import { getStoreAbsoluteUrl, getStoreUrl } from '@/lib/craft-urls';
import type { MyStoreInfo } from '@/lib/types';

// HIRFA (P8) — artisan "حسابي": the store's PUBLIC identity card.
//
// Shows the store display name + avatar, the STABLE public store URL
// (absolute, copyable, and openable in-place), and an OPTIONAL edit form for
// the name + avatar saved through PATCH /api/craft/artisan/me. Collapsed by
// default: the store works without ever forcing a profile-completion step.
//
// The store SLUG is deliberately not editable here — it is generated once (at
// apply / backfill) so /craft/<slug> stays stable for life after a rename.
export function ArtisanProfileCard({
  myStore,
  isAr,
  onUpdated,
  onManageProducts,
}: {
  myStore: MyStoreInfo;
  isAr: boolean;
  onUpdated: (store: MyStoreInfo) => void;
  onManageProducts: () => void;
}) {
  const { t } = useT();
  const mt = getMarketplaceT(isAr ? 'ar' : 'fr');
  const absoluteUrl = getStoreAbsoluteUrl(myStore.slug, myStore.id);
  const storePath = getStoreUrl(myStore.slug, myStore.id);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(myStore.displayName);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Keep the field in sync if the store row changes upstream (e.g. saved
  // from another tab).
  useEffect(() => {
    setName(myStore.displayName);
  }, [myStore.displayName]);

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

  const handleSave = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      toast.error(t.storeNameMin);
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('displayName', trimmed);
      if (avatarFile) fd.append('avatar', avatarFile);
      const updated = await api.updateMyStore(fd);
      onUpdated(updated);
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setAvatarFile(null);
      setAvatarPreview(null);
      setEditing(false);
      toast.success(t.storeUpdated);
    } catch {
      toast.error(
        isAr ? 'تعذر تحديث بيانات المتجر' : 'Échec de la mise à jour de la boutique'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(null);
    setAvatarPreview(null);
    setName(myStore.displayName);
    setEditing(false);
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(absoluteUrl);
      toast.success(mt.linkCopied);
    } catch {
      window.prompt(isAr ? 'رابط متجرك' : 'Lien de votre boutique', absoluteUrl);
    }
  };

  const avatarSrc = avatarPreview ?? myStore.avatarUrl;


  return (
    <Card className="overflow-hidden p-0">
      {/* Header: store avatar + name + "my store" badge */}
      <div className="bg-gradient-to-br from-primary to-brand-dark p-5 text-primary-foreground">
        <div className="flex items-center gap-3">
          {avatarSrc ? (
            <img src={avatarSrc} alt="" className="h-16 w-16 rounded-2xl object-cover" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
              <Store size={26} />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{myStore.displayName}</p>
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold backdrop-blur">
              <Store size={10} /> {mt.myStore}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-3 p-4">
        {/* Public store link: stable for life (the slug never regenerates). */}
        <div>
          <p className="mb-1.5 text-[11px] font-black uppercase tracking-wide text-muted-foreground">
            {t.storePublicLink}
          </p>
          <div dir="ltr" className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-2.5 py-2 text-xs text-primary">
              {absoluteUrl}
            </code>
            <Button
              variant="outline"
              className="h-9 shrink-0 gap-1.5 rounded-lg px-3 text-xs font-bold"
              onClick={onCopy}
            >
              <Link2 size={14} />
              {mt.copyStoreLink}
            </Button>
          </div>
          <Link
            href={storePath}
            prefetch={false}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-primary underline-offset-2 hover:underline"
          >
            <ExternalLink size={13} />
            {t.visitStore}
          </Link>
        </div>

        {editing ? (
          <div className="space-y-3 rounded-2xl border border-border bg-card/60 p-3">
            <label className="flex items-center gap-3">
              <span className="relative shrink-0 cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={handlePickAvatar}
                />
                {avatarSrc ? (
                  <img src={avatarSrc} alt="" className="h-14 w-14 rounded-full object-cover" />
                ) : (
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                    <Camera size={20} className="text-muted-foreground" />
                  </span>
                )}
              </span>
              <span className="text-xs font-semibold text-muted-foreground">
                {isAr ? 'صورة المتجر' : 'Image de la boutique'}
              </span>
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.storeName}
              maxLength={80}
            />
            <div className="flex gap-2">
              <Button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 gap-1.5 rounded-xl bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-700"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {t.saveStoreInfo}
              </Button>
              <Button
                onClick={handleCancelEdit}
                variant="outline"
                className="gap-1.5 rounded-xl text-xs font-bold"
              >
                <X size={14} />
                {t.cancel}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button
              onClick={() => setEditing(true)}
              variant="outline"
              className="flex-1 gap-1.5 rounded-xl text-xs font-bold"
            >
              <Pencil size={14} />
              {t.editStoreInfo}
            </Button>
            <Button
              onClick={onManageProducts}
              variant="outline"
              className="flex-1 gap-1.5 rounded-xl text-xs font-bold"
            >
              <Package size={14} />
              {t.manageProducts}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
