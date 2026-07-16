import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const secondaryConfig = {
  apiKey: "AIzaSyB_sA0peKgiDudDGks0RNlwq6cB0IOer1M",
  authDomain: "koperasi-unipdu.firebaseapp.com",
  projectId: "koperasi-unipdu",
  storageBucket: "koperasi-unipdu.firebasestorage.app",
  messagingSenderId: "10094241377",
  appId: "1:10094241377:web:1b11e23f8479306733ec20"
};

async function check() {
  const app = initializeApp(secondaryConfig, 'secondary_check');
  const db = getFirestore(app);
  
  const [usersSnap, loansSnap] = await Promise.all([
    getDocs(collection(db, 'users')),
    getDocs(collection(db, 'simpanPinjam'))
  ]);
  
  console.log("=== Matching Koperasi Users (containing 'Helmi') ===");
  usersSnap.forEach(doc => {
    const data = doc.data();
    if (JSON.stringify(data).toLowerCase().includes('helmi')) {
      console.log(`Doc ID: ${doc.id}`);
      console.log(data);
    }
  });
  
  console.log("\n=== Matching Koperasi Loans (containing 'Helmi') ===");
  loansSnap.forEach(doc => {
    const data = doc.data();
    if (JSON.stringify(data).toLowerCase().includes('helmi')) {
      console.log(`Doc ID: ${doc.id}`);
      console.log(`Borrower Name (userData.namaLengkap): ${data.userData?.namaLengkap}`);
      console.log(`userId field in loan: ${data.userId}`);
    }
  });
  
  process.exit(0);
}

check().catch(console.error);
