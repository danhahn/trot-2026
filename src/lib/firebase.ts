import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getFirestore, doc, setDoc, onSnapshot, type Firestore } from 'firebase/firestore';
import type { AppState } from './types.js';

export const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyAOYbV0mgULkGzarqqUW0ojdkJUs47_B_k",
  authDomain: "trot-2026.firebaseapp.com",
  projectId: "trot-2026",
  storageBucket: "trot-2026.firebasestorage.app",
  messagingSenderId: "624441275892",
  appId: "1:624441275892:web:de2506f9736f8321bbb5a1"
};

const DOC_ID = 'state';
let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let unsubscribe: (() => void) | null = null;

export function getFirebaseDb(): Firestore | null {
  if (typeof window === 'undefined') return null;
  if (!db) {
    try {
      if (!getApps().length) {
        app = initializeApp(DEFAULT_FIREBASE_CONFIG);
      } else {
        app = getApps()[0];
      }
      db = getFirestore(app);
    } catch (e) {
      console.error('Failed to initialize Firebase:', e);
    }
  }
  return db;
}

/**
 * Saves state directly to Cloud Firestore so all volunteers see real-time updates.
 */
export async function pushStateToCloud(state: AppState): Promise<void> {
  const database = getFirebaseDb();
  if (!database) return;

  try {
    const docRef = doc(database, 'turkey_trot', DOC_ID);
    await setDoc(docRef, {
      ...state,
      lastUpdated: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Cloud sync push error (using local cache):', err);
  }
}

/**
 * Real-time listener: triggers whenever any volunteer changes a bag status, edits a runner, etc.
 */
export function listenToCloudState(
  onStateChange: (remoteState: AppState) => void,
  onStatusChange?: (connected: boolean) => void
): () => void {
  const database = getFirebaseDb();
  if (!database) return () => {};

  if (unsubscribe) {
    unsubscribe();
  }

  const docRef = doc(database, 'turkey_trot', DOC_ID);
  unsubscribe = onSnapshot(docRef, (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.data() as AppState;
      if (data && data.participants && data.bags) {
        if (onStatusChange) onStatusChange(true);
        onStateChange(data);
      }
    } else {
      if (onStatusChange) onStatusChange(true);
    }
  }, (err) => {
    console.warn('Cloud listener notice:', err);
    if (onStatusChange) onStatusChange(false);
  });

  return () => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
}
