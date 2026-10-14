import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "./config";

// ── Projects ──────────────────────────────────────────────────────────────────

export const createProject = async (uid, name) => {
  const ref = collection(db, "users", uid, "projects");
  return addDoc(ref, { name, createdAt: serverTimestamp() });
};

export const deleteProject = async (uid, projectId) => {
  // delete all sections first is handled by cloud functions in prod;
  // for now just remove the project doc
  return deleteDoc(doc(db, "users", uid, "projects", projectId));
};

export const subscribeProjects = (uid, callback) => {
  const q = query(
    collection(db, "users", uid, "projects"),
    orderBy("createdAt", "desc")
  );
  return onSnapshot(q, (snap) => {
    const projects = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(projects);
  });
};

// ── Sections ──────────────────────────────────────────────────────────────────

export const createSection = async (uid, projectId, name, thickness = 10) => {
  const ref = collection(db, "users", uid, "projects", projectId, "sections");
  return addDoc(ref, {
    name,
    createdAt: serverTimestamp(),
    rowCount: 0,
    columns: [],
    thickness: Number(thickness) || 10,
  });
};

export const deleteSection = async (uid, projectId, sectionId) => {
  return deleteDoc(
    doc(db, "users", uid, "projects", projectId, "sections", sectionId)
  );
};

export const updateSectionName = async (uid, projectId, sectionId, name) => {
  return updateDoc(
    doc(db, "users", uid, "projects", projectId, "sections", sectionId),
    { name }
  );
};

export const subscribeSections = (uid, projectId, callback) => {
  const q = query(
    collection(db, "users", uid, "projects", projectId, "sections"),
    orderBy("createdAt", "asc")
  );
  return onSnapshot(q, (snap) => {
    const sections = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(sections);
  });
};

// ── Section Data (chunked rows) ───────────────────────────────────────────────

const CHUNK_SIZE = 150; // rows per Firestore document

export const saveSectionData = async (
  uid,
  projectId,
  sectionId,
  rows,
  columns
) => {
  const batch = writeBatch(db);

  // Update section metadata
  const sectionRef = doc(
    db,
    "users",
    uid,
    "projects",
    projectId,
    "sections",
    sectionId
  );
  batch.update(sectionRef, { rowCount: rows.length, columns });

  // Write chunks
  const chunksRef = collection(sectionRef, "chunks");

  // Clear existing chunks first
  const existingChunks = await getDocs(chunksRef);
  existingChunks.docs.forEach((d) => batch.delete(d.ref));

  // Write new chunks
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunkRows = rows.slice(i, i + CHUNK_SIZE);
    const chunkRef = doc(chunksRef, `chunk_${Math.floor(i / CHUNK_SIZE)}`);
    batch.set(chunkRef, { rows: chunkRows, index: Math.floor(i / CHUNK_SIZE) });
  }

  await batch.commit();
};

export const getSectionData = async (uid, projectId, sectionId) => {
  const sectionRef = doc(
    db,
    "users",
    uid,
    "projects",
    projectId,
    "sections",
    sectionId
  );
  const sectionSnap = await getDoc(sectionRef);
  if (!sectionSnap.exists()) {
    return {
      rows: [],
      columns: [],
      excludedStations: [],
      thickness: 10,
      hiddenColumns: { data: [], normalized: [] },
    };
  }

  const {
    columns,
    excludedStations = [],
    thickness = 10,
    hiddenColumns = { data: [], normalized: [] },
  } = sectionSnap.data();
  const chunksRef = collection(sectionRef, "chunks");
  const chunksSnap = await getDocs(query(chunksRef, orderBy("index", "asc")));

  const rows = chunksSnap.docs.flatMap((d) => d.data().rows);
  const normalizedHidden = Array.isArray(hiddenColumns)
    ? { data: hiddenColumns, normalized: hiddenColumns }
    : {
        data: hiddenColumns?.data ?? [],
        normalized: hiddenColumns?.normalized ?? [],
      };

  return {
    rows,
    columns,
    excludedStations,
    thickness: thickness !== undefined ? thickness : 10,
    hiddenColumns: normalizedHidden,
  };
};

export const updateSectionThickness = async (
  uid,
  projectId,
  sectionId,
  thickness
) => {
  if (!uid || !projectId || !sectionId) return;
  const sectionRef = doc(
    db,
    "users",
    uid,
    "projects",
    projectId,
    "sections",
    sectionId
  );
  const parsed = parseFloat(thickness);
  const validThickness = !isNaN(parsed) && parsed > 0 ? parsed : 10;
  await setDoc(sectionRef, { thickness: validThickness }, { merge: true });
};

export const updateSectionExcludedStations = async (
  uid,
  projectId,
  sectionId,
  excludedStations
) => {
  const sectionRef = doc(
    db,
    "users",
    uid,
    "projects",
    projectId,
    "sections",
    sectionId
  );
  await setDoc(sectionRef, { excludedStations }, { merge: true });
};

export const updateSectionHiddenColumns = async (
  uid,
  projectId,
  sectionId,
  hiddenColumns
) => {
  if (!uid || !projectId || !sectionId) return;
  const sectionRef = doc(
    db,
    "users",
    uid,
    "projects",
    projectId,
    "sections",
    sectionId
  );
  await setDoc(sectionRef, { hiddenColumns }, { merge: true });
};

// ── User Settings / Statewide Equation / Default Hidden Columns ───────────────

export const getUserEquation = async (uid) => {
  if (!uid) return null;
  try {
    const userRef = doc(db, "users", uid);
    const snap = await getDoc(userRef);
    if (snap.exists() && snap.data().statewideEquation) {
      return snap.data().statewideEquation;
    }
  } catch (err) {
    console.error("Failed to load user equation from Firestore:", err);
  }
  return null;
};

export const saveUserEquation = async (uid, coeffA, powerB) => {
  if (!uid) return;
  const userRef = doc(db, "users", uid);
  await setDoc(
    userRef,
    {
      statewideEquation: {
        a: String(coeffA),
        b: String(powerB),
        updatedAt: serverTimestamp(),
      },
    },
    { merge: true }
  );
};

export const getUserDefaultHiddenColumns = async (uid) => {
  if (!uid) return null;
  try {
    const userRef = doc(db, "users", uid);
    const snap = await getDoc(userRef);
    if (snap.exists() && snap.data().defaultHiddenColumns) {
      const hc = snap.data().defaultHiddenColumns;
      return Array.isArray(hc)
        ? { data: hc, normalized: hc }
        : { data: hc?.data ?? [], normalized: hc?.normalized ?? [] };
    }
  } catch (err) {
    console.error("Failed to load default hidden columns from Firestore:", err);
  }
  return null;
};

export const saveUserDefaultHiddenColumns = async (uid, hiddenColumns) => {
  if (!uid) return;
  const userRef = doc(db, "users", uid);
  await setDoc(
    userRef,
    {
      defaultHiddenColumns: hiddenColumns,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};
