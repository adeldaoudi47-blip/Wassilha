'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, ImagePlus, X, Loader2, Plus, Trash2, Video } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type {
  CraftCategoryPublic, CraftProductPublic, ProductTierPublic, ProductVariantPublic,
} from '@/lib/types';
import { useT } from '../use-t';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

// HIRFA Phase 3: local row shapes for the variant & tier managers. Both keep
// an optional `id` so an EDIT can preserve existing rows — the PATCH endpoint
// treats the arrays as a full replacement (absent rows are deleted).
interface VariantDraft {
  id?: string;
  nameAr: string;
  nameFr: string;
  priceAdjustment: string;
  stock: string;
}

interface TierDraft {
  id?: string;
  minQuantity: string;
  unitPrice: string;
}

// HIRFA (P5): create / edit a craft product. Owns the image-upload flow
// (via /api/craft/upload -> Vercel Blob) and sends the final URL array +
// metadata to POST/PATCH /api/craft/products. The price is validated
// server-side; this form only collects it.
export function ArtisanProductForm({
  product,
  onDone,
  onCancel,
}: {
  product: CraftProductPublic | null;
  onDone: () => void;
  onCancel: () => void;
  categories?: CraftCategoryPublic[];
}) {
  const { t, isAr } = useT();
  const [imageUrls, setImageUrls] = useState<string[]>(product?.images ?? []);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [categories, setCategories] = useState<CraftCategoryPublic[]>([]);
  const [form, setForm] = useState({
    nameAr: product?.nameAr ?? '',
    nameFr: product?.nameFr ?? '',
    descriptionAr: product?.descriptionAr ?? '',
    descriptionFr: product?.descriptionFr ?? '',
    price: product ? String(product.price) : '',
    categoryId: product?.category?.id ?? '',
    stock: product ? String(product.stock) : '',
    isMadeToOrder: product?.isMadeToOrder ?? false,
    // HIRFA Phase 3: optional product video (YouTube or Blob URL).
    videoUrl: product?.videoUrl ?? '',
  });
  // HIRFA Phase 3: variant & tier drafts. Seeded from the product on edit so
  // the artisan sees what is currently stored.
  const [variantDrafts, setVariantDrafts] = useState<VariantDraft[]>(
    (product?.variants ?? []).map((v: ProductVariantPublic) => ({
      id: v.id,
      nameAr: v.nameAr,
      nameFr: v.nameFr ?? '',
      priceAdjustment: String(v.priceAdjustment ?? 0),
      stock: String(v.stock ?? 0),
    })),
  );
  const [tierDrafts, setTierDrafts] = useState<TierDraft[]>(
    (product?.tiers ?? []).map((tr: ProductTierPublic) => ({
      id: tr.id,
      minQuantity: String(tr.minQuantity),
      unitPrice: String(tr.unitPrice),
    })),
  );
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const Back = isAr ? ArrowRight : ArrowLeft;

  useEffect(() => { api.getCraftCategories().then(setCategories).catch(() => undefined); }, []);

  const pickImages = (files: FileList | null) => {
    if (!files) return;
    setUploading(true);
    const arr = Array.from(files).slice(0, 8 - imageUrls.length);
    let count = 0;
    Promise.all(
      arr.map(async (file) => {
        try {
          const { url } = await api.uploadCraftImage(file);
          setImageUrls((prev) => [...prev, url]);
          count++;
        } catch { toast.error(t.uploadFailed); }
      }),
    ).finally(() => { setUploading(false); if (count) toast.success(t.imageUploaded); });
  };

  const removeImage = (url: string) => setImageUrls((prev) => prev.filter((u) => u !== url));

  // HIRFA Phase 3: variant draft mutators.
  const addVariant = () =>
    setVariantDrafts((prev) => [...prev, { nameAr: '', nameFr: '', priceAdjustment: '0', stock: '0' }]);
  const updateVariant = (i: number, k: keyof VariantDraft, v: string) =>
    setVariantDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, [k]: v } : d)));
  const removeVariant = (i: number) => setVariantDrafts((prev) => prev.filter((_, idx) => idx !== i));

  // HIRFA Phase 3: tier draft mutators.
  const addTier = () => setTierDrafts((prev) => [...prev, { minQuantity: '10', unitPrice: '' }]);
  const updateTier = (i: number, k: keyof TierDraft, v: string) =>
    setTierDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, [k]: v } : d)));
  const removeTier = (i: number) => setTierDrafts((prev) => prev.filter((_, idx) => idx !== i));

  const handleSubmit = async () => {
    const nameAr = form.nameAr.trim();
    const price = Number(form.price);
    if (nameAr.length < 2) { toast.error(t.storeNameRequired); return; }
    if (!form.categoryId) { toast.error(t.productCategory); return; }
    if (!Number.isFinite(price) || price < 1) { toast.error(t.productPrice); return; }

    // HIRFA Phase 3: normalise + validate the drafts. Rows with no name (for
    // variants) or no numbers (for tiers) are dropped so a stray empty row
    // never reaches the API; the server re-validates everything anyway.
    const variants = variantDrafts
      .map((d) => ({
        id: d.id,
        nameAr: d.nameAr.trim(),
        nameFr: d.nameFr.trim() || null,
        priceAdjustment: Number(d.priceAdjustment) || 0,
        stock: Number(d.stock) || 0,
      }))
      .filter((d) => d.nameAr.length >= 1);
    const tiers = tierDrafts
      .map((d) => ({
        id: d.id,
        minQuantity: Math.max(2, Number(d.minQuantity) || 0),
        unitPrice: Number(d.unitPrice) || 0,
      }))
      .filter((d) => Number.isFinite(d.minQuantity) && Number.isFinite(d.unitPrice) && d.unitPrice > 0);
    // A duplicate minQuantity would make pickTier ambiguous, so they must be unique.
    const seenQty = new Set<number>();
    for (const tr of tiers) {
      if (seenQty.has(tr.minQuantity)) {
        toast.error(isAr ? 'كميات كل مستوى يجب أن تكون مختلفة' : 'Les paliers doivent avoir des quantités différentes');
        return;
      }
      seenQty.add(tr.minQuantity);
    }

    setSubmitting(true);
    try {
      const payload = {
        nameAr,
        nameFr: form.nameFr.trim() || undefined,
        descriptionAr: form.descriptionAr.trim() || undefined,
        descriptionFr: form.descriptionFr.trim() || undefined,
        price: Math.round(price),
        categoryId: form.categoryId,
        images: imageUrls,
        // Made-to-order products are crafted on demand: stock is meaningless
        // for them, so it is zeroed and never checked at checkout.
        stock: form.isMadeToOrder ? 0 : Number(form.stock) || 0,
        isMadeToOrder: form.isMadeToOrder,
        // HIRFA Phase 3: video + the full-replacement variant/tier lists. An
        // empty array is sent explicitly (not undefined) so removing the last
        // row on EDIT actually clears them server-side.
        videoUrl: form.videoUrl.trim() || null,
        variants,
        tiers,
      };
      if (product) await api.updateCraftProduct(product.id, payload);
      else await api.createCraftProduct(payload);
      toast.success(t.productSaved);
      onDone();
    } catch {
      toast.error(isAr ? 'تعذر حفظ المنتج' : 'Enregistrement impossible');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4">
      <button onClick={onCancel} className="inline-flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-foreground">
        <Back size={16} /> {t.back}
      </button>
      <h2 className="text-lg font-black text-foreground">{product ? t.editProduct : t.addProduct}</h2>

      {/* Images */}
      <div className="space-y-2">
        <p className="text-xs font-bold text-foreground">{t.uploadMultipleImages}</p>
        <div className="flex flex-wrap gap-2">
          {imageUrls.map((u) => (
            <div key={u} className="relative h-16 w-16 overflow-hidden rounded-xl">
              <img src={u} alt="" className="h-full w-full object-cover" />
              <button onClick={() => removeImage(u)} className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white">
                <X size={10} />
              </button>
            </div>
          ))}
          {imageUrls.length < 8 && (
            <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-xl border border-dashed bg-muted text-muted-foreground">
              {uploading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
              <input type="file" accept="image/*" multiple hidden onChange={(e) => pickImages(e.target.files)} />
            </label>
          )}
        </div>
        {uploading && (
          <p className="flex items-center gap-1.5 text-xs text-primary">
            <Loader2 size={12} className="animate-spin" />
            {t.uploadingImages}
          </p>
        )}
      </div>

      {/* Form fields */}
      <div className="space-y-3">
        <div className="space-y-1.5"><label className="text-xs font-bold text-foreground">{t.productName}</label><Input value={form.nameAr} onChange={(e) => set('nameAr', e.target.value)} maxLength={120} /></div>
        <div className="space-y-1.5"><label className="text-xs font-bold text-foreground">{t.productName} (FR)</label><Input value={form.nameFr} onChange={(e) => set('nameFr', e.target.value)} maxLength={120} /></div>
        <div className="space-y-1.5"><label className="text-xs font-bold text-foreground">{t.productDescription}</label><Textarea value={form.descriptionAr} onChange={(e) => set('descriptionAr', e.target.value)} rows={3} maxLength={2000} /></div>
        <div className="space-y-1.5"><label className="text-xs font-bold text-foreground">{t.productDescription} (FR)</label><Textarea value={form.descriptionFr} onChange={(e) => set('descriptionFr', e.target.value)} rows={3} maxLength={2000} /></div>
        <div className="space-y-1.5"><label className="text-xs font-bold text-foreground">{t.productCategory}</label><Select value={form.categoryId} onValueChange={(v) => set('categoryId', v)}><SelectTrigger className="w-full"><SelectValue placeholder={t.chooseArea} /></SelectTrigger><SelectContent>{categories.map((c) => (<SelectItem key={c.id} value={c.id}>{isAr ? c.nameAr : c.nameFr || c.nameAr}</SelectItem>))}</SelectContent></Select></div>
        <div className="space-y-1.5"><label className="text-xs font-bold text-foreground">{t.productPrice}</label><Input value={form.price} onChange={(e) => set('price', e.target.value)} inputMode="numeric" dir="ltr" placeholder="300" /></div>
        {/* "حسب الطلب" toggle: crafted on demand, so stock is ignored everywhere. */}
        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-muted/30 p-2.5">
          <input
            type="checkbox"
            checked={form.isMadeToOrder}
            onChange={() => setForm((f) => ({ ...f, isMadeToOrder: !f.isMadeToOrder }))}
            className="mt-0.5 h-4 w-4 accent-emerald-600"
          />
          <span className="space-y-0.5">
            <span className="block text-xs font-bold text-foreground">{t.isMadeToOrderLabel}</span>
            <span className="block text-[11px] text-muted-foreground">{t.madeToOrderHint}</span>
          </span>
        </label>
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-foreground">{t.productStock} (0 = {t.madeToOrder})</label>
          <Input
            value={form.stock}
            onChange={(e) => set('stock', e.target.value)}
            inputMode="numeric"
            dir="ltr"
            placeholder="1"
            disabled={form.isMadeToOrder}
            className={form.isMadeToOrder ? 'opacity-40' : ''}
          />
          {form.isMadeToOrder && (
            <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400">{t.madeToOrderHint}</p>
          )}
        </div>
        <Button onClick={handleSubmit} disabled={submitting} className="h-12 w-full rounded-xl bg-emerald-600 text-sm font-black text-white hover:bg-emerald-700">
          {submitting && <Loader2 size={16} className="me-1 animate-spin" />}{t.saveProduct}
        </Button>

        {/* HIRFA Phase 3: optional product video (YouTube or Blob). */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-xs font-bold text-foreground">
            <Video size={13} className="text-primary" />
            {t.videoUrl}
          </label>
          <Input
            value={form.videoUrl}
            onChange={(e) => set('videoUrl', e.target.value)}
            dir="ltr"
            placeholder="https://youtu.be/…"
            maxLength={500}
          />
          <p className="text-[11px] text-muted-foreground">{t.videoUrlHint}</p>
        </div>

        {/* HIRFA Phase 3: variants manager. Each row is a purchasable SKU with
            its own stock and a price adjustment (+/-) on top of `price`. The
            array is a full replacement, so deleting a row here deletes it
            server-side on save. */}
        <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-black text-foreground">{t.variant} ({variantDrafts.length})</p>
            <button
              onClick={addVariant}
              type="button"
              className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-[11px] font-bold text-primary"
            >
              <Plus size={12} />
              {t.variant}
            </button>
          </div>
          {variantDrafts.length === 0 ? (
            <p className="py-1 text-[11px] text-muted-foreground">
              {isAr
                ? 'لا توجد خيارات. أضف خياراً (لون/حجم) ليختاره المشتري.'
                : 'Aucune variante. Ajoutez-en une (couleur/taille) pour que l’acheteur puisse choisir.'}
            </p>
          ) : (
            <div className="space-y-2">
              {variantDrafts.map((d, i) => (
                <div key={d.id ?? i} className="space-y-1.5 rounded-lg border border-border bg-card p-2">
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={d.nameAr}
                      onChange={(e) => updateVariant(i, 'nameAr', e.target.value)}
                      placeholder={isAr ? 'الاسم (عربي)' : 'Nom (AR)'}
                      maxLength={60}
                      className="h-8 flex-1 text-xs"
                    />
                    <button
                      onClick={() => removeVariant(i)}
                      type="button"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                      aria-label="×"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={d.nameFr}
                      onChange={(e) => updateVariant(i, 'nameFr', e.target.value)}
                      placeholder="Nom (FR)"
                      maxLength={60}
                      className="h-8 flex-1 text-xs"
                    />
                    <Input
                      value={d.priceAdjustment}
                      onChange={(e) => updateVariant(i, 'priceAdjustment', e.target.value)}
                      inputMode="numeric"
                      dir="ltr"
                      placeholder="±0"
                      className="h-8 w-16 text-xs"
                    />
                    <Input
                      value={d.stock}
                      onChange={(e) => updateVariant(i, 'stock', e.target.value)}
                      inputMode="numeric"
                      dir="ltr"
                      placeholder="0"
                      className="h-8 w-16 text-xs"
                      disabled={form.isMadeToOrder}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* HIRFA Phase 3: graduated (wholesale) price ladder. minQuantity must
            stay >= 2 (1 would just be the base price) and be unique per rung
            — the submit handler enforces that before sending, since two rungs
            with the same threshold would make pickTier ambiguous. */}
        <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-black text-foreground">{t.wholesalePricing} ({tierDrafts.length})</p>
            <button
              onClick={addTier}
              type="button"
              className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-[11px] font-bold text-primary"
            >
              <Plus size={12} />
              {t.wholesalePricing}
            </button>
          </div>
          {tierDrafts.length === 0 ? (
            <p className="py-1 text-[11px] text-muted-foreground">
              {isAr
                ? 'لا توجد أسعار جملة. أضف مستوى (الكمية ⇒ سعر الوحدة).'
                : 'Aucun tarif de gros. Ajoutez un palier (quantité ⇒ prix unitaire).'}
            </p>
          ) : (
            <div className="space-y-2">
              {tierDrafts.map((d, i) => (
                <div key={d.id ?? i} className="flex items-center gap-1.5 rounded-lg border border-border bg-card p-2">
                  <div className="flex flex-1 items-center gap-1">
                    <span className="text-[10px] font-bold text-muted-foreground">≥</span>
                    <Input
                      value={d.minQuantity}
                      onChange={(e) => updateTier(i, 'minQuantity', e.target.value)}
                      inputMode="numeric"
                      dir="ltr"
                      placeholder="10"
                      className="h-8 w-16 text-xs"
                    />
                    <span className="text-[10px] text-muted-foreground">⇒</span>
                    <Input
                      value={d.unitPrice}
                      onChange={(e) => updateTier(i, 'unitPrice', e.target.value)}
                      inputMode="numeric"
                      dir="ltr"
                      placeholder="250"
                      className="h-8 w-20 text-xs"
                    />
                    <span className="text-[10px] text-muted-foreground">{t.currencyDzd}</span>
                  </div>
                  <button
                    onClick={() => removeTier(i)}
                    type="button"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                    aria-label="×"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">{t.tierHint}</p>
        </div>
      </div>
    </div>
  );
}
