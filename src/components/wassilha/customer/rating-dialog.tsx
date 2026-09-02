'use client';

import { useEffect, useState } from 'react';
import { Star, Send } from 'lucide-react';
import { z } from 'zod';
import { useT } from '../use-t';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

type RatingDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  driverName?: string | null;
  onSubmitted?: () => void;
};

// Local Zod schema for client-side validation. Mirrors the server-side
// guards in /api/orders/:id/rate. Kept in sync by hand because the two
// share the same business rules; the dialog never sends anything the
// server would reject.
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

export function RatingDialog({
  open,
  onOpenChange,
  orderId,
  driverName,
  onSubmitted,
}: RatingDialogProps) {
  const { t, isAr } = useT();
  const [score, setScore] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reset every time the dialog opens so a re-open after a previous
  // submission starts from a clean state.
  useEffect(() => {
    if (open) {
      setScore(0);
      setHover(0);
      setComment('');
      setSubmitting(false);
    }
  }, [open]);

  const display = hover || score;

  const handleSubmit = async () => {
    const parsed = ratingSchema.safeParse({ score, comment });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast.error(isAr ? 'اختر تقييماً من 1 إلى 5 نجوم' : 'Veuillez choisir une note entre 1 et 5');
      return;
    }

    setSubmitting(true);
    try {
      await api.rateOrder(orderId, parsed.data.score, parsed.data.comment);
      toast.success(t.thankYou);
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
      // Lightweight inline overlay: we deliberately avoid re-using the
      // shadcn <Dialog> here because the host (customer-track) already
      // owns one and stacking them causes focus-trap conflicts on mobile.
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
        aria-labelledby="rating-dialog-title"
      >
        <h2
          id="rating-dialog-title"
          className="text-center text-lg font-black text-foreground"
        >
          {t.rateYourTrip}
        </h2>
        <p className="mt-1 text-center text-xs text-muted-foreground">
          {t.howWasYourTrip}
          {driverName ? (
            <>
              {' '}
              <span className="font-semibold text-foreground">{driverName}</span>
            </>
          ) : null}
        </p>

        {/* Interactive stars */}
        <div
          className="my-4 flex items-center justify-center gap-1.5"
          role="radiogroup"
          aria-label={t.rateYourTrip}
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
