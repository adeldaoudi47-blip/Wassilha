'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, ImagePlus, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { CraftCategoryPublic, CraftProductPublic } from '@/lib/types';
import { useT } from '../use-t';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

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
  });
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

  const handleSubmit = async () => {
    const nameAr = form.nameAr.trim();
    const price = Number(form.price);
    if (nameAr.length < 2) { toast.error(t.storeNameRequired); return; }
    if (!form.categoryId) { toast.error(t.productCategory); return; }
    if (!Number.isFinite(price) || price < 1) { toast.error(t.productPrice); return; }
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
        stock: Number(form.stock) || 0,
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

      {/* Form fields */}
      <div className="space-y-3">
        <div className="space-y-1.5"><label className="text-xs font-bold text-foreground">{t.productName}</label><Input value={form.nameAr} onChange={(e) => set('nameAr', e.target.value)} maxLength={120} /></div>
        <div className="space-y-1.5"><label className="text-xs font-bold text-foreground">{t.productName} (FR)</label><Input value={form.nameFr} onChange={(e) => set('nameFr', e.target.value)} maxLength={120} /></div>
        <div className="space-y-1.5"><label className="text-xs font-bold text-foreground">{t.productDescription}</label><Textarea value={form.descriptionAr} onChange={(e) => set('descriptionAr', e.target.value)} rows={3} maxLength={2000} /></div>
        <div className="space-y-1.5"><label className="text-xs font-bold text-foreground">{t.productDescription} (FR)</label><Textarea value={form.descriptionFr} onChange={(e) => set('descriptionFr', e.target.value)} rows={3} maxLength={2000} /></div>
        <div className="space-y-1.5"><label className="text-xs font-bold text-foreground">{t.productCategory}</label><Select value={form.categoryId} onValueChange={(v) => set('categoryId', v)}><SelectTrigger className="w-full"><SelectValue placeholder={t.chooseArea} /></SelectTrigger><SelectContent>{categories.map((c) => (<SelectItem key={c.id} value={c.id}>{isAr ? c.nameAr : c.nameFr || c.nameAr}</SelectItem>))}</SelectContent></Select></div>
        <div className="space-y-1.5"><label className="text-xs font-bold text-foreground">{t.productPrice}</label><Input value={form.price} onChange={(e) => set('price', e.target.value)} inputMode="numeric" dir="ltr" placeholder="300" /></div>
        <div className="space-y-1.5"><label className="text-xs font-bold text-foreground">{t.productStock} (0 = {t.madeToOrder})</label><Input value={form.stock} onChange={(e) => set('stock', e.target.value)} inputMode="numeric" dir="ltr" placeholder="1" /></div>
        <Button onClick={handleSubmit} disabled={submitting} className="h-12 w-full rounded-xl bg-emerald-600 text-sm font-black text-white hover:bg-emerald-700">
          {submitting && <Loader2 size={16} className="me-1 animate-spin" />}{t.saveProduct}
        </Button>
      </div>
    </div>
  );
}
