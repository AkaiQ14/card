const { getFirestore } = require("./firebase-config");

const LEADERBOARD_COLLECTION = "leaderboard";
const ABILITIES_COLLECTION = "abilities";
const LEADERBOARD_DOC_ID = "main";
const ABILITIES_DOC_ID = "main";

// ===== Leaderboard Functions =====

/**
 * قراءة Leaderboard من Firebase
 */
async function readLeaderboardFromFirebase() {
  try {
    const db = getFirestore();
    if (!db) {
      // Firebase غير مُعد
      return { players: {} };
    }
    
    const doc = await db.collection(LEADERBOARD_COLLECTION).doc(LEADERBOARD_DOC_ID).get();
    
    if (!doc.exists) {
      return { players: {} };
    }
    
    const data = doc.data();
    if (data && typeof data === "object" && data.players) {
      return data;
    }
    
    return { players: {} };
  } catch (error) {
    // لا نطبع خطأ - Firebase اختياري
    return { players: {} };
  }
}

/**
 * حفظ Leaderboard إلى Firebase
 */
async function writeLeaderboardToFirebase(data) {
  try {
    const db = getFirestore();
    if (!db) {
      // Firebase غير مُعد - هذا طبيعي
      return false;
    }
    
    await db.collection(LEADERBOARD_COLLECTION).doc(LEADERBOARD_DOC_ID).set(data, { merge: false });
    return true;
  } catch (error) {
    // لا نطبع خطأ - Firebase اختياري
    return false;
  }
}

// ===== Abilities Functions =====

/**
 * قراءة Abilities من Firebase
 */
async function readAbilitiesFromFirebase() {
  try {
    const db = getFirestore();
    if (!db) {
      // Firebase غير مُعد
      return [];
    }
    
    const doc = await db.collection(ABILITIES_COLLECTION).doc(ABILITIES_DOC_ID).get();
    
    if (!doc.exists) {
      return [];
    }
    
    const data = doc.data();
    if (data && Array.isArray(data.abilities)) {
      return data.abilities.map(s => String(s).trim()).filter(Boolean);
    }
    
    return [];
  } catch (error) {
    // لا نطبع خطأ - Firebase اختياري
    return [];
  }
}

/**
 * حفظ Abilities إلى Firebase
 */
async function writeAbilitiesToFirebase(abilitiesArray) {
  try {
    const clean = abilitiesArray.map(s => String(s).trim()).filter(Boolean);
    const data = { abilities: clean };
    
    const db = getFirestore();
    if (!db) {
      // Firebase غير مُعد - هذا طبيعي
      return null;
    }
    
    await db.collection(ABILITIES_COLLECTION).doc(ABILITIES_DOC_ID).set(data, { merge: false });
    return clean;
  } catch (error) {
    // لا نطبع خطأ - Firebase اختياري
    return null;
  }
}

module.exports = {
  readLeaderboardFromFirebase,
  writeLeaderboardToFirebase,
  readAbilitiesFromFirebase,
  writeAbilitiesToFirebase,
};
