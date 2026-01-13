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
    const doc = await db.collection(LEADERBOARD_COLLECTION).doc(LEADERBOARD_DOC_ID).get();
    
    if (!doc.exists) {
      console.log("[firebase] Leaderboard document not found, returning default");
      return { players: {} };
    }
    
    const data = doc.data();
    if (data && typeof data === "object" && data.players) {
      console.log("[firebase] ✅ Leaderboard loaded from Firebase");
      return data;
    }
    
    return { players: {} };
  } catch (error) {
    console.error("[firebase] ❌ Failed to read leaderboard:", error.message);
    return { players: {} };
  }
}

/**
 * حفظ Leaderboard إلى Firebase
 */
async function writeLeaderboardToFirebase(data) {
  try {
    const db = getFirestore();
    await db.collection(LEADERBOARD_COLLECTION).doc(LEADERBOARD_DOC_ID).set(data, { merge: false });
    console.log("[firebase] ✅ Leaderboard saved to Firebase");
    return true;
  } catch (error) {
    console.error("[firebase] ❌ Failed to save leaderboard:", error.message);
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
    const doc = await db.collection(ABILITIES_COLLECTION).doc(ABILITIES_DOC_ID).get();
    
    if (!doc.exists) {
      console.log("[firebase] Abilities document not found, returning empty array");
      return [];
    }
    
    const data = doc.data();
    if (data && Array.isArray(data.abilities)) {
      console.log("[firebase] ✅ Abilities loaded from Firebase");
      return data.abilities.map(s => String(s).trim()).filter(Boolean);
    }
    
    return [];
  } catch (error) {
    console.error("[firebase] ❌ Failed to read abilities:", error.message);
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
    await db.collection(ABILITIES_COLLECTION).doc(ABILITIES_DOC_ID).set(data, { merge: false });
    console.log("[firebase] ✅ Abilities saved to Firebase");
    return clean;
  } catch (error) {
    console.error("[firebase] ❌ Failed to save abilities:", error.message);
    return null;
  }
}

module.exports = {
  readLeaderboardFromFirebase,
  writeLeaderboardToFirebase,
  readAbilitiesFromFirebase,
  writeAbilitiesToFirebase,
};
