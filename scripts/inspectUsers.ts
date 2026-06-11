import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, limit, query } from "firebase/firestore";

const secondaryConfig = {
  apiKey: "AIzaSyB_sA0peKgiDudDGks0RNlwq6cB0IOer1M",
  authDomain: "koperasi-unipdu.firebaseapp.com",
  projectId: "koperasi-unipdu",
  storageBucket: "koperasi-unipdu.firebasestorage.app",
  messagingSenderId: "10094241377",
  appId: "1:10094241377:web:1b11e23f8479306733ec20"
};

async function main() {
  console.log("Initializing secondary Firebase App...");
  const app = initializeApp(secondaryConfig);
  const db = getFirestore(app);

  console.log("Fetching sample documents from 'users' collection...");
  try {
    const q = query(collection(db, "users"), limit(5));
    const querySnapshot = await getDocs(q);
    console.log(`Successfully fetched ${querySnapshot.size} documents.`);

    querySnapshot.docs.forEach((doc, idx) => {
      console.log(`\nDocument ${idx + 1} ID: ${doc.id}`);
      console.log(JSON.stringify(doc.data(), null, 2));
    });
  } catch (error) {
    console.error("Error fetching users:", error);
  }
}

main();
