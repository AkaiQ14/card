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
        console.warn("[firebase] ⚠️ Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:", e.message);
        console.warn("[firebase] ⚠️ Firebase backup will be disabled");
        return null;
      }
    } else {
      // طريقة 2: استخدام Application Default Credentials (للتطوير المحلي)
      // أو متغيرات البيئة الفردية
      const projectId = process.env.FIREBASE_PROJECT_ID;
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
      const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

      if (projectId && clientEmail && privateKey) {
        try {
          firebaseApp = admin.initializeApp({
            credential: admin.credential.cert({
              projectId,
              clientEmail,
              privateKey,
            }),
          });
          console.log("[firebase] ✅ Initialized with individual env vars");
        } catch (e) {
          console.warn("[firebase] ⚠️ Failed to initialize with env vars:", e.message);
          console.warn("[firebase] ⚠️ Firebase backup will be disabled");
          return null;
        }
      } else {
        // Firebase غير مُعد - هذا طبيعي، سيعمل المشروع بدون Firebase
        console.log("[firebase] ℹ️ Firebase not configured (backup disabled)");
        return null;
      }
    }

    db = admin.firestore();
    return { app: firebaseApp, db };
  } catch (error) {
    console.warn("[firebase] ⚠️ Firebase initialization failed:", error.message);
    console.warn("[firebase] ⚠️ Server will continue without Firebase backup");
    return null;
  }
}

// Initialize on module load (optional - won't fail if not configured)
initializeFirebase();

function getFirestore() {
  if (!db) {
    const result = initializeFirebase();
    if (!result || !result.db) {
      return null;
    }
  }
  return db;
}

module.exports = {
  initializeFirebase,
  getFirestore,
  admin,
};
