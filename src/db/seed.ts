import { prisma } from './client.js';

// Mirrors src/data/syntheticData.ts OperatingProfile[] in the SAHAY frontend.
const OPERATING_PROFILES = [
  { name: 'Heavy Freight', fuelMultiplier: 1.3, wearMultiplier: 1.4, maintenanceFreqMultiplier: 1.3, failureProbMultiplier: 1.2, annualKm: 180000, annualHours: 4500, description: 'Long-haul heavy freight, high tonnage.' },
  { name: 'Passenger', fuelMultiplier: 1.0, wearMultiplier: 0.9, maintenanceFreqMultiplier: 1.0, failureProbMultiplier: 0.9, annualKm: 150000, annualHours: 5000, description: 'Intercity passenger service.' },
  { name: 'Yard Switching', fuelMultiplier: 0.6, wearMultiplier: 1.6, maintenanceFreqMultiplier: 1.5, failureProbMultiplier: 1.3, annualKm: 20000, annualHours: 3500, description: 'Low-speed, high-cycle yard work.' },
  { name: 'Metro', fuelMultiplier: 0.8, wearMultiplier: 1.1, maintenanceFreqMultiplier: 1.2, failureProbMultiplier: 1.0, annualKm: 100000, annualHours: 6000, description: 'High-frequency urban transit.' },
  { name: 'Mining', fuelMultiplier: 1.5, wearMultiplier: 1.8, maintenanceFreqMultiplier: 1.6, failureProbMultiplier: 1.5, annualKm: 60000, annualHours: 5500, description: 'Heavy-duty mining haulage.' },
  { name: 'Mountain', fuelMultiplier: 1.4, wearMultiplier: 1.5, maintenanceFreqMultiplier: 1.3, failureProbMultiplier: 1.2, annualKm: 90000, annualHours: 4000, description: 'Steep grade, high brake wear.' },
  { name: 'Desert', fuelMultiplier: 1.1, wearMultiplier: 1.3, maintenanceFreqMultiplier: 1.2, failureProbMultiplier: 1.2, annualKm: 140000, annualHours: 4200, description: 'High ambient temperature operation.' },
  { name: 'Cold Climate', fuelMultiplier: 1.2, wearMultiplier: 1.2, maintenanceFreqMultiplier: 1.2, failureProbMultiplier: 1.3, annualKm: 120000, annualHours: 4300, description: 'Sub-zero operation, cold-start wear.' },
];

async function main() {
  for (const profile of OPERATING_PROFILES) {
    await prisma.operatingProfile.upsert({
      where: { id: `seed-profile-${profile.name.toLowerCase().replace(/\s+/g, '-')}` },
      create: { id: `seed-profile-${profile.name.toLowerCase().replace(/\s+/g, '-')}`, organizationId: null, ...profile },
      update: profile,
    });
  }
  console.log(`Seeded ${OPERATING_PROFILES.length} global operating profiles.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
