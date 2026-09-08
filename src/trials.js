/* Trial backdrops — dropped images/videos for rapid iteration, kept in this
   browser's IndexedDB so they survive reloads. Local by design: shared links
   always show hosted content from public/content/ (SPEC §3); a trial is the
   owner's private scratchpad until a file is promoted into the repo. */

const DB = 'haveli-previz', STORE = 'trials';

function openDb() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(STORE, { keyPath: 'id' });
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}

const tx = (db, mode) => db.transaction(STORE, mode).objectStore(STORE);
const done = rq => new Promise((res, rej) => {
  rq.onsuccess = () => res(rq.result);
  rq.onerror = () => rej(rq.error);
});

export function kindOf(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return null;
}

export async function addTrial(file) {
  const kind = kindOf(file);
  if (!kind) throw new Error(`${file.name}: not an image or video`);
  const rec = {
    id: crypto.randomUUID(), name: file.name, kind,
    type: file.type, size: file.size, added: Date.now(), blob: file
  };
  const db = await openDb();
  await done(tx(db, 'readwrite').put(rec));
  db.close();
  return rec;
}

export async function listTrials() {
  const db = await openDb();
  const all = await done(tx(db, 'readonly').getAll());
  db.close();
  return all.sort((a, b) => b.added - a.added);
}

export async function getTrial(id) {
  const db = await openDb();
  const rec = await done(tx(db, 'readonly').get(id));
  db.close();
  return rec;
}

export async function deleteTrial(id) {
  const db = await openDb();
  await done(tx(db, 'readwrite').delete(id));
  db.close();
}

export const fmtSize = b =>
  b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' :
  b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' kB';
