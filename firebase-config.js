const admin = require("firebase-admin");

// Initialize Firebase Admin SDK
// يمكن استخدام Service Account Key من متغيرات البيئة
// أو استخدام Application Default Credentials
let firebaseApp = null;
let db = null;

function initializeFirebase() {
  if (firebaseApp) {
    return { app: firebaseApp, db };
  }

  try {
    // طريقة 1: استخدام Service Account Key من متغير البيئة
    const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (serviceAccountKey) {
      try {
        const serviceAccount = JSON.parse(serviceAccountKey);
        firebaseApp = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
        console.log("[firebase] ✅ Initialized with Service Account Key");
      } catch (e) {
        console.error("[firebase] ❌ Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:", e.message);
        throw e;
      }
    } else {
      // طريقة 2: استخدام Application Default Credentials (للتطوير المحلي)
      // أو متغيرات البيئة الفردية
      const projectId = process.env.FIREBASE_PROJECT_ID;
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
      const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

      if (projectId && clientEmail && privateKey) {
        firebaseApp = admin.initializeApp({
          credential: admin.credential.cert({
            projectId,
            clientEmail,
            privateKey,
          }),
        });
        console.log("[firebase] ✅ Initialized with individual env vars");
      } else {
        // طريقة 3: Application Default Credentials (للتطوير المحلي)
        firebaseApp = admin.initializeApp();
        console.log("[firebase] ✅ Initialized with Application Default Credentials");
      }
    }

    db = admin.firestore();
    return { app: firebaseApp, db };
  } catch (error) {
    console.error("[firebase] ❌ Initialization failed:", error.message);
    throw error;
  }
}

// Initialize on module load
try {
  initializeFirebase();
} catch (e) {
  console.warn("[firebase] ⚠️ Firebase not initialized. Will retry on first use.");
}

function getFirestore() {
  if (!db) {
    initializeFirebase();
  }
  return db;
}

module.exports = {
  initializeFirebase,
  getFirestore,
  admin,
};
