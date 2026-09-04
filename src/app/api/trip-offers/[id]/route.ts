// TRIP OFFERS — single offer operations
// -----------------------------------------------------------------------------
// DELETE /api/trip-offers/[id]
//   - driver only; the offer must belong to the calling driver
//   - sets `status = 'cancelled'`. We never hard-delete because the
//     order side (an Order created from a book) keeps a back-pointer
//     `tripOffer` and we'd lose audit trail.
//   - refuses if the offer is already booked (returns 409): a
//     customer has committed to it; the driver must let it run or
//     the customer must cancel their order separately.
// -----------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession as getSessionUser } from '@/lib/auth';
import { publicTripOfferSelect } from '@/lib/dto';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user || user.role !== 'driver') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const driver = await db.driver.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (!driver) {
    return NextResponse.json({ error: 'no_driver_profile' }, { status: 404 });
  }
  const offer = await db.tripOffer.findUnique({
    where: { id },
    select: { id: true, driverId: true, status: true },
  });
  if (!offer) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (offer.driverId !== driver.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (offer.status === 'booked') {
    return NextResponse.json(
      { error: 'offer_already_booked' },
      { status: 409 },
    );
  }
  if (offer.status === 'cancelled') {
    // Idempotent: a second DELETE on a cancelled offer is a no-op
    // and returns 200 (the resource is already in the desired state).
    return NextResponse.json({ offer: { id, status: 'cancelled' } });
  }
  const updated = await db.tripOffer.update({
    where: { id },
    data: { status: 'cancelled' },
    select: publicTripOfferSelect,
  });
  return NextResponse.json({ offer: updated });
}
