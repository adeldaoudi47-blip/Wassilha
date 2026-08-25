import { db } from '../src/lib/db';
import { CARGO_MULTIPLIERS_DEFAULT, generateOrderCode } from '../src/lib/wassilha-data';

async function main() {
  console.log('🌱 Seeding WASSILHA database...');

  // Clean
  await db.rating.deleteMany();
  await db.vehicle.deleteMany();
  await db.order.deleteMany();
  await db.driver.deleteMany();
  await db.user.deleteMany();
  await db.pricing.deleteMany();

  // Pricing config
  await db.pricing.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      basePrice: 150,
      perKm: 60,
      multipliers: JSON.stringify(CARGO_MULTIPLIERS_DEFAULT),
    },
  });

  // Admin
  const admin = await db.user.create({
    data: { phone: '0700000000', name: 'إدارة وصّلها', role: 'admin' },
  });

  // Drivers
  const driverData = [
    { name: 'أحمد بن سالم', phone: '0555123456', vehicleType: 'Triporteur 125cc', vehicleColor: 'أزرق', rating: 4.9, trips: 342, earnings: 184500 },
    { name: 'محمد لعروسي', phone: '0661234789', vehicleType: 'Triporteur 150cc', vehicleColor: 'أبيض', rating: 4.7, trips: 210, earnings: 112800 },
    { name: 'ياسين قاسمي', phone: '0770987654', vehicleType: 'Triporteur 125cc', vehicleColor: 'أحمر', rating: 4.8, trips: 189, earnings: 98300 },
    { name: 'عبد الرحمن حمداوي', phone: '0555778899', vehicleType: 'Triporteur 150cc', vehicleColor: 'أخضر', rating: 4.6, trips: 156, earnings: 84200 },
  ];
 const drivers: {
  user: {
    id: string;
    role: string;
    name: string;
    phone: string;
    avatar: string | null;
  };
  driver: {
    id: string;
    userId: string;
  };
}[] = [];
  for (const d of driverData) {
    const u = await db.user.create({ data: { phone: d.phone, name: d.name, role: 'driver' } });
    const drv = await db.driver.create({
      data: {
        userId: u.id,
        vehicleType: d.vehicleType,
        vehicleColor: d.vehicleColor,
        plateNumber: `${d.phone.slice(-4)}-DW`,
        isOnline: d.trips % 2 === 0,
        isVerified: true,
        rating: d.rating,
        totalTrips: d.trips,
        totalEarnings: d.earnings,
      },
    });
    await db.vehicle.create({
      data: { driverId: drv.id, type: d.vehicleType, color: d.vehicleColor, plateNumber: `${d.phone.slice(-4)}-DW`, capacityKg: 500 },
    });
    drivers.push({ user: u, driver: drv });
  }

  // Customers
  const custNames = [
    { name: 'سفيان بوزيد', phone: '0660112233' },
    { name: 'كريمة زيدان', phone: '0770445566' },
    { name: 'نبيل مرابط', phone: '0555889900' },
  ];
const customers: {
  id: string;
  role: string;
  name: string;
  phone: string;
  avatar: string | null;
}[] = [];
  for (const c of custNames) {
    const u = await db.user.create({ data: { phone: c.phone, name: c.name, role: 'customer' } });
    customers.push(u);
  }

  // Orders (mix of statuses & time spread)
  const locations = [
    'حي 05 جويلية - القرارة',
    'وسط المدينة - القرارة',
    'حي المستقبل - القرارة',
    'طريق غرداية - القرارة',
    'سوق القرارة المركزي',
    'حي النصر - القرارة',
    'المنطقة الصناعية - القرارة',
    'حي الواحة - القرارة',
  ];
  const cargoTypes = ['parcel', 'goods', 'shop', 'furniture', 'appliance', 'construction', 'personal', 'other'];
  const statuses: ('searching' | 'accepted' | 'picked' | 'delivered' | 'cancelled')[] = [
    'delivered', 'delivered', 'delivered', 'delivered', 'picked', 'accepted', 'searching', 'delivered', 'cancelled', 'delivered', 'picked', 'delivered',
  ];

  const now = new Date();
  for (let i = 0; i < statuses.length; i++) {
    const cust = customers[i % customers.length];
    const drv = drivers[i % drivers.length];
    const cargo = cargoTypes[i % cargoTypes.length];
    const pi = i % locations.length;
    const di = (i + 3) % locations.length;
    const distance = 1.5 + (i % 5) * 0.8;
    const price = Math.round((150 + distance * 60) * (CARGO_MULTIPLIERS_DEFAULT[cargo as keyof typeof CARGO_MULTIPLIERS_DEFAULT] || 1));
    const created = new Date(now.getTime() - (statuses.length - i) * 3600 * 1000 * 6);
    const status = statuses[i];

    const acceptedAt = status !== 'searching' && status !== 'cancelled' ? new Date(created.getTime() + 2 * 60000) : null;
    const pickedAt = (status === 'picked' || status === 'delivered') ? new Date(created.getTime() + 8 * 60000) : null;
    const deliveredAt = status === 'delivered' ? new Date(created.getTime() + 22 * 60000) : null;
    const cancelledAt = status === 'cancelled' ? new Date(created.getTime() + 5 * 60000) : null;

    await db.order.create({
      data: {
        code: generateOrderCode(),
        customerId: cust.id,
        driverId: status === 'searching' ? null : drv.user.id,
        cargoType: cargo,
        pickup: locations[pi],
        dropoff: locations[di],
        pickupLat: 32.78 + (Math.random() - 0.5) * 0.03,
        pickupLng: 3.76 + (Math.random() - 0.5) * 0.03,
        dropoffLat: 32.78 + (Math.random() - 0.5) * 0.03,
        dropoffLng: 3.76 + (Math.random() - 0.5) * 0.03,
        weight: [20, 50, 80, 120, 200][i % 5],
        distance,
        price,
        status,
        notes: i % 3 === 0 ? 'الطابق الثاني، اتصل عند الوصول' : null,
        rating: status === 'delivered' ? 4 + (i % 2) : null,
        createdAt: created,
        acceptedAt,
        pickedAt,
        deliveredAt,
        cancelledAt,
      },
    });
  }

  console.log(`✅ Seeded: 1 admin, ${drivers.length} drivers, ${customers.length} customers, ${statuses.length} orders, pricing config`);
  console.log('   Demo logins:');
  console.log('   - Customer: 0660112233 (OTP 0000)');
  console.log('   - Driver:   0555123456 (OTP 0000)');
  console.log('   - Admin:    0700000000 (OTP 0000)');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
