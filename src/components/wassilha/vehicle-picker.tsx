"use client";

// ---------------------------------------------------------------------------
// OFFICIAL VEHICLE PICKER (vehicle-classification task)
//
// One component for all three vehicle pickers so the driver application form,
// the cargo wizard and the taxi flow cannot drift apart: same six categories,
// same two service headings, same mobile-first layout, same i18n keys.
//
// multi = true  → toggle tiles, CARGO only (the customer may accept an amprita
//                 OR a small truck for the same order).
// multi = false → radio list, TAXI only (one vehicle per taxi booking).
//
// The caller owns the value; this component never persists anything, so the
// server remains the only place a category is validated.
// ---------------------------------------------------------------------------
import { Bike, Car, Truck, Check } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import {
  CARGO_VEHICLE_CATEGORIES,
  TAXI_VEHICLE_CATEGORIES,
  VEHICLE_CATEGORY_LABELS,
  VEHICLE_GROUP_LABELS,
  normalizeVehicleCategory,
} from '@/lib/types';
import type { OfficialVehicleCategory, VehicleServiceSide } from '@/lib/types';

const VEHICLE_ICON: Record<OfficialVehicleCategory, typeof Bike> = {
  cargo_moto_2: Bike,
  cargo_tricycle: Car,
  cargo_small_truck: Truck,
  cargo_large_truck: Truck,
  taxi_up_to_4: Car,
  taxi_over_5: Truck,
};

export interface VehiclePickerProps {
  /** Which half of the vocabulary to offer. Decides the visible categories. */
  side: VehicleServiceSide;
  multi: boolean;
  /** Currently selected official categories. */
  value: readonly OfficialVehicleCategory[];
  onChange: (next: OfficialVehicleCategory[]) => void;
  /** Locale string from the app's existing i18n context. */
  t: Record<string, string>;
  /** Optional per-category disable rule (e.g. moto on a large shipment). */
  isDisabled?: (category: OfficialVehicleCategory) => boolean;
  className?: string;
}
export function VehiclePicker({
  side,
  multi,
  value,
  onChange,
  t,
  isDisabled,
  className,
}: VehiclePickerProps) {
  const tt = (k: string) => t[k] ?? k;
  const categories = multi ? [...CARGO_VEHICLE_CATEGORIES] : [...TAXI_VEHICLE_CATEGORIES];
  const groupTitle = tt(VEHICLE_GROUP_LABELS[side]);
  const heading = multi ? tt('selectVehicleTypes') : tt('selectVehicleType');
  const help = multi ? tt('selectVehicleTypesHelp') : undefined;

  // A legacy value ('moto') is normalised before comparison, so a form
  // pre-filled from an old order still shows the right tile as selected.
  const selected = value
    .map((c) => normalizeVehicleCategory(c))
    .filter((c): c is OfficialVehicleCategory => c !== null);

  const toggle = (category: OfficialVehicleCategory) => {
    if (!multi) {
      onChange([category]);
      return;
    }
    onChange(
      selected.includes(category)
        ? selected.filter((c) => c !== category)
        : [...selected, category]
    );
  };

  return (
    <div className={cn('space-y-3', className)}>
      <div>
        <p className="text-sm font-bold leading-tight">{heading}</p>
        {help ? <p className="text-[11px] text-muted-foreground">{help}</p> : null}
      </div>

      <div role={multi ? 'group' : 'radiogroup'} aria-label={groupTitle} className="space-y-2">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
          {side === 'CARGO' ? '🚚' : '🚕'} {groupTitle}
        </p>

        {multi ? (
          // Toggle tiles — the customer can pick one OR several categories.
          <div className="grid grid-cols-2 gap-2">
            {categories.map((category) => {
              const Icon = VEHICLE_ICON[category];
              const checked = selected.includes(category);
              const disabled = isDisabled?.(category) ?? false;
              return (
                <button
                  key={category}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  disabled={disabled}
                  onClick={() => toggle(category)}
                  className={cn(
                    'flex min-h-[68px] flex-col items-center justify-center gap-1 rounded-xl border-2 p-2 text-center transition-colors',
                    'disabled:cursor-not-allowed disabled:opacity-40',
                    checked ? 'border-primary bg-primary/10' : 'border-border bg-background hover:bg-muted'
                  )}
                >
                  <span className="flex items-center gap-1">
                    <Icon size={20} />
                    {checked ? <Check size={14} className="text-primary" /> : null}
                  </span>
                  <span className="text-[11px] font-bold leading-tight">
                    {tt(VEHICLE_CATEGORY_LABELS[category])}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          // Radio list — a taxi booking is one vehicle, never two.
          <RadioGroup
            value={selected[0] ?? ''}
            onValueChange={(v) => toggle(v as OfficialVehicleCategory)}
            className="space-y-2"
          >
            {categories.map((category) => {
              const Icon = VEHICLE_ICON[category];
              const disabled = isDisabled?.(category) ?? false;
              return (
                <label
                  key={category}
                  className={cn(
                    'flex min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border-2 p-3 transition-colors',
                    'has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/10',
                    disabled && 'cursor-not-allowed opacity-40'
                  )}
                >
                  <RadioGroupItem value={category} disabled={disabled} />
                  <Icon size={20} />
                  <span className="text-sm font-bold">{tt(VEHICLE_CATEGORY_LABELS[category])}</span>
                </label>
              );
            })}
          </RadioGroup>
        )}
      </div>
    </div>
  );
}