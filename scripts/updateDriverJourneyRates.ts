import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');

if (!admin.apps.length) {
  if (fs.existsSync(serviceAccountPath)) {
    console.log('Using local service-account.json for authentication...');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'internal-bak',
    });
  } else {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'internal-bak',
    });
  }
}

const db = admin.firestore();

const LATEST_VEHICLE_RATES: Record<string, number> = {
  'Bis': 2500,
  'Elf': 1350,
  'Kijang LGX': 1200,
  'Innova Hitam': 1250,
  'Innova Matic': 1450,
  'Suzuki': 1000,
  'Suzuki XL7': 1000,
  'Ndalem': 0,
};

function getEffectiveVehicleRate(vName?: string, savedRate?: number): number {
  if (!vName) return savedRate || 1000;
  if (LATEST_VEHICLE_RATES[vName] !== undefined) return LATEST_VEHICLE_RATES[vName];
  for (const [k, v] of Object.entries(LATEST_VEHICLE_RATES)) {
    if (vName.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return savedRate || 1000;
}

async function run() {
  console.log("Fetching DriverJourneys...");
  const snap = await db.collection('DriverJourneys').get();
  console.log(`Found ${snap.size} journeys.`);

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const vehicleName = data.vehicleName || data.vehicleType;
    const newRate = getEffectiveVehicleRate(vehicleName, data.vehicleRate);
    
    const distanceKm = data.distanceKm || 0;
    const preAuthorizedMeal = data.preAuthorizedMeal || 0;
    const preAuthorizedToll = data.preAuthorizedToll || 0;
    const newTotalOperationalCost = Math.round(distanceKm * newRate) + preAuthorizedMeal + preAuthorizedToll;

    console.log(`Updating ${docSnap.id} (${vehicleName}): vehicleRate ${data.vehicleRate} -> ${newRate}, totalOperationalCost ${data.totalOperationalCost} -> ${newTotalOperationalCost}`);
    
    await db.collection('DriverJourneys').doc(docSnap.id).update({
      vehicleRate: newRate,
      totalOperationalCost: newTotalOperationalCost,
      baseOperationalCost: Math.round(distanceKm * newRate),
    });
  }

  console.log("Migration complete!");
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
