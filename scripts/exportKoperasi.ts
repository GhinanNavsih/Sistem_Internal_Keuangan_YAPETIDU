import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import * as fs from "fs";
import * as path from "path";

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

  console.log("Fetching documents from 'simpanPinjam' collection...");
  try {
    const querySnapshot = await getDocs(collection(db, "simpanPinjam"));
    console.log(`Successfully fetched ${querySnapshot.size} documents.`);

    const docs = querySnapshot.docs.map(doc => {
      return {
        id: doc.id,
        ...doc.data()
      };
    });

    const outputPath = path.join(process.cwd(), "simpanPinjam.json");
    fs.writeFileSync(outputPath, JSON.stringify(docs, null, 2), "utf8");
    console.log(`Successfully exported data to: ${outputPath}`);
  } catch (error) {
    console.error("Error fetching or writing data:", error);
    process.exit(1);
  }
}

main();
