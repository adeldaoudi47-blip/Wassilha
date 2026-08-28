const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const users = await p.user.findMany({ select: { id: true, phone: true, name: true, role: true, accountStatus: true } });
  const drivers = await p.driver.findMany({ select: { id: true, userId: true, vehicleType: true, isOnline: true, isVerified: true } });
  console.log('=== USERS ===');
  users.forEach(u => console.log(JSON.stringify(u)));
  console.log('=== DRIVERS ===');
  drivers.forEach(d => console.log(JSON.stringify(d)));
  const admins = users.filter(u => u.role === 'admin');
  const custs = users.filter(u => u.role === 'customer');
  const drivs = users.filter(u => u.role === 'driver');
  console.log('ADMINS:' + admins.length + ' DRIVERS:' + drivs.length + ' CUSTOMERS:' + custs.length);
  await p.$disconnect();
})();
