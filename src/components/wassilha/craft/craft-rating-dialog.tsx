'use client';

import { useEffect, useState } from 'react';
import { Star, Send, ImagePlus, X, Loader2 } from 'lucide-react';
import { z } from 'zod';
import { useT } from '../use-t';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// HIRFA Phase 3: max review photos (mirrors the server-side cap in
// /api/craft/orders/[id]/rate, which slices to 6 regardless of what is sent).
const MAX_REVIEW_IMAGES = 6;

type CraftRatingDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  artisanName?: string | null;
  onSubmitted?: () => void;
};

// Local Zod schema for client-side validation. Mirrors the server-side
// guards in /api/craft/orders/[id]/rate.
const ratingSchema = z.object({
  score: z
    .number()
    .int('invalidScore')
    .min(1, 'invalidScore')
    .max(5, 'invalidScore'),
  comment: z
    .string()
    .max(200, 'commentTooLong')
    .trim()
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export function CraftRatingDialog({
  open,
  onOpenChange,
  orderId,
  artisanName,
  onSubmitted,
}: CraftRatingDialogProps) {
  const { t, isAr } = useT();
  const [score, setScore] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // HIRFA Phase 3: photo review. URLs only — the files are uploaded through
  // the same /api/craft/upload endpoint product images use, so this dialog
  // never accepts a raw file toward the rating API.
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  // Reset every time the dialog opens
  useEffect(() => {
    if (open) {
      setScore(0);
      setHover(0);
      setComment('');
      setSubmitting(false);
      setImages([]);
    }
  }, [open]);

  const display = hover || score;

  const pickImages = (files: FileList | null) => {
    if (!files) return;
    setUploading(true);
    const arr = Array.from(files).slice(0, MAX_REVIEW_IMAGES - images.length);
    Promise.all(
      arr.map(async (file) => {
        try {
          const { url } = await api.uploadCraftImage(file);
          setImages((prev) => [...prev, url]);
        } catch {
          toast.error(t.uploadFailed);
        }
      }),
    ).finally(() => setUploading(false));
  };

  const handleSubmit = async () => {
    const parsed = ratingSchema.safeParse({ score, comment });
    if (!parsed.success) {
      toast.error(isAr ? 'اختر تقييماً من 1 إلى 5 نجوم' : 'Veuillez choisir une note entre 1 et 5');
      return;
    }

    setSubmitting(true);
    try {
      await api.rateCraftOrder(orderId, parsed.data.score, parsed.data.comment, images);
      toast.success(t.ratingSubmitted);
      onOpenChange(false);
      onSubmitted?.();
    } catch {
      toast.error(isAr ? 'فشل التقييم' : 'Échec de l\'évaluation');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4',
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        'transition-opacity duration-200'
      )}
      onClick={() => onOpenChange(false)}
      aria-hidden={!open}
    >
      <div
        dir={isAr ? 'rtl' : 'ltr'}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="craft-rating-dialog-title"
      >
        <h2
          id="craft-rating-dialog-title"
          className="text-center text-lg font-black text-foreground"
        >
          {t.rateCraftOrder}
        </h2>
        <p className="mt-1 text-center text-xs text-muted-foreground">
          {isAr ? 'قيّم تجربتك مع' : 'Évaluez votre expérience avec'}
          {artisanName ? (
            <>
              {' '}
              <span className="font-semibold text-foreground">{artisanName}</span>
            </>
          ) : null}
        </p>

        {/* Interactive stars */}
        <div
          className="my-4 flex items-center justify-center gap-1.5"
          role="radiogroup"
          aria-label={t.rateCraftOrder}
        >
          {[1, 2, 3, 4, 5].map((n) => {
            const active = n <= display;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={n === score}
                aria-label={`${n}/5`}
                disabled={submitting}
                onClick={() => setScore(n)}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                className={cn(
                  'rounded-full p-1 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  'hover:scale-110',
                  submitting && 'cursor-not-allowed opacity-50'
                )}
              >
                <Star
                  size={32}
                  className={cn(
                    'transition-colors',
                    active ? 'text-amber-400' : 'text-muted-foreground/40'
                  )}
                  fill={active ? 'currentColor' : 'none'}
                  strokeWidth={1.5}
                />
              </button>
            );
          })}
        </div>

        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={200}
          rows={3}
          disabled={submitting}
          placeholder={isAr ? 'تعليق اختياري...' : 'Commentaire optionnel...'}
          className="resize-none text-sm"
        />
        <p className="mt-1 text-end text-[10px] text-muted-foreground">
          {comment.length}/200
        </p>

        {/* HIRFA Phase 3: photo review (Alibaba-style). Files are uploaded to
            /api/craft/upload first; only URLs are sent to the rating API,
            which re-validates http(s) and re-caps the count server-side. */}
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-2">
            {images.map((url) => (
              <div key={url} className="relative h-16 w-16 overflow-hidden rounded-xl border border-border">
                <img src={url} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => setImages((prev) => prev.filter((u) => u !== url))}
                  disabled={submitting}
                  className="absolute end-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"
                  aria-label="×"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
            {images.length < MAX_REVIEW_IMAGES && (
              <label
                className={cn(
                  'flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border-2 border-dashed border-border bg-muted/30 text-muted-foreground',
                  uploading && 'opacity-50',
                  submitting && 'pointer-events-none opacity-50',
                )}
              >
                {uploading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <ImagePlus size={16} />
                )}
                <span className="text-[9px] font-bold">{t.attachReviewPhotos}</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => pickImages(e.target.files)}
                />
              </label>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {images.length}/{MAX_REVIEW_IMAGES}
          </p>
        </div>

        <div className="mt-3 flex gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="flex-1"
          >
            {isAr ? 'إلغاء' : 'Annuler'}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || score < 1}
            className="flex-1 bg-primary"
          >
            <Send size={15} className="me-1.5" />
            {submitting ? '...' : t.submitRating}
          </Button>
        </div>
      </div>
    </div>
  );
}
