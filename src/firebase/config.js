import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyDxU5CizpXxgNLRFPGE3dF865D_hk5Ia4I",
  authDomain: "fwd-analysis.firebaseapp.com",
  projectId: "fwd-analysis",
  storageBucket: "fwd-analysis.firebasestorage.app",
  messagingSenderId: "671079024246",
  appId: "1:671079024246:web:049fe294e5c0dfb688c157",
  measurementId: "G-3P07RCFHL7",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const analytics = getAnalytics(app);
export default app;
