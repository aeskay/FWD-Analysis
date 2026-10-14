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

export const createSection = async (uid, projectId, name) => {
  const ref = collection(db, "users", uid, "projects", projectId, "sections");
  return addDoc(ref, {
    name,
    createdAt: serverTimestamp(),
    rowCount: 0,
    columns: [],
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
  if (!sectionSnap.exists()) return { rows: [], columns: [], excludedStations: [] };

  const { columns, excludedStations = [] } = sectionSnap.data();
  const chunksRef = collection(sectionRef, "chunks");
  const chunksSnap = await getDocs(query(chunksRef, orderBy("index", "asc")));

  const rows = chunksSnap.docs.flatMap((d) => d.data().rows);
  return { rows, columns, excludedStations };
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
