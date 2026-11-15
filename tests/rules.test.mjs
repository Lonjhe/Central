// Tests des règles de sécurité CENTRAL — lancés par `npm test` (émulateur Firestore)
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, serverTimestamp, increment, Timestamp } from "firebase/firestore";

const sha = s => createHash("sha256").update(s).digest("hex");
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "central-test",
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 },
  });
});
after(async () => { await env.cleanup() });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "config/public"), { epoch: 1 });
    await setDoc(doc(db, "secrets/access"), { hash: sha("CLETEST01") });
    await setDoc(doc(db, "admins/boss"), { nom: "Organisateur" });
    await setDoc(doc(db, "missions/01"), { locked: false, openAt: null, hintCount: 2, hintsShown: 0, cons: "x" });
    await setDoc(doc(db, "missions/01/hints/0"), { text: "indice 1" });
    await setDoc(doc(db, "missions/01/hints/1"), { text: "indice 2" });
    await setDoc(doc(db, "answers/01"), { hashes: [sha("REPONSE1")] });
    await setDoc(doc(db, "fragments/01"), { text: "FRAGMENT DE TEST." });
    await setDoc(doc(db, "missions/02"), { locked: true, openAt: null, hintCount: 0, hintsShown: 0 });
    await setDoc(doc(db, "answers/02"), { hashes: [sha("REPONSE2")] });
    await setDoc(doc(db, "missions/03"), { locked: false, openAt: Timestamp.fromMillis(Date.now() + 864e5), hintCount: 0, hintsShown: 0 });
    await setDoc(doc(db, "answers/03"), { hashes: [sha("REPONSE3")] });
  });
});

const as = uid => env.authenticatedContext(uid).firestore();
const join = (db, uid, code = "CLETEST01", epoch = 1) => setDoc(doc(db, "players", uid), { code, epoch, name: "Agent " + uid, at: serverTimestamp() });
const solve = (db, uid, id, answer) => setDoc(doc(db, "progress", id), { answer, at: serverTimestamp(), by: uid, name: "Agent " + uid });

test("un visiteur non connecté ne lit rien d'utile", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, "config/public")));
  await assertFails(getDoc(doc(db, "missions/01")));
  await assertFails(getDocs(collection(db, "progress")));
});

test("mauvaise clé refusée, bonne clé acceptée", async () => {
  const db = as("p1");
  await assertFails(join(db, "p1", "FAUX"));
  await assertFails(join(db, "p1", "CLETEST01", 0));
  await assertFails(join(db, "p2", "CLETEST01"));
  await assertSucceeds(join(db, "p1"));
  await assertSucceeds(getDocs(collection(db, "missions")));
  await assertSucceeds(getDocs(collection(db, "progress")));
});

test("secrets, réponses et joueurs des autres sont illisibles", async () => {
  const db = as("p1"); await join(db, "p1");
  await assertFails(getDoc(doc(db, "secrets/access")));
  await assertFails(getDoc(doc(db, "answers/01")));
  await assertFails(getDoc(doc(as("p2"), "players/p1")));
});

test("validation : mauvaise réponse refusée, bonne acceptée une seule fois", async () => {
  const a = as("p1"), b = as("p2"); await join(a, "p1"); await join(b, "p2");
  await assertFails(solve(a, "p1", "01", "FAUX"));
  await assertFails(solve(a, "p2", "01", "REPONSE1"));
  await assertSucceeds(solve(a, "p1", "01", "REPONSE1"));
  await assertFails(solve(b, "p2", "01", "REPONSE1"));
  await assertFails(deleteDoc(doc(b, "progress/01")));
});

test("secteur verrouillé ou pas encore ouvert : validation impossible", async () => {
  const a = as("p1"); await join(a, "p1");
  await assertFails(solve(a, "p1", "02", "REPONSE2"));
  await assertFails(solve(a, "p1", "03", "REPONSE3"));
});

test("fragment lisible seulement après restauration", async () => {
  const a = as("p1"); await join(a, "p1");
  await assertFails(getDoc(doc(a, "fragments/01")));
  await solve(a, "p1", "01", "REPONSE1");
  await assertSucceeds(getDoc(doc(a, "fragments/01")));
});

test("indices : un par un, lisibles seulement une fois révélés", async () => {
  const a = as("p1"); await join(a, "p1");
  await assertFails(getDoc(doc(a, "missions/01/hints/0")));
  await assertSucceeds(updateDoc(doc(a, "missions/01"), { hintsShown: increment(1) }));
  await assertSucceeds(getDoc(doc(a, "missions/01/hints/0")));
  await assertFails(getDoc(doc(a, "missions/01/hints/1")));
  await assertFails(updateDoc(doc(a, "missions/01"), { hintsShown: 5 }));
  await assertFails(updateDoc(doc(a, "missions/01"), { cons: "piraté" }));
  await assertSucceeds(updateDoc(doc(a, "missions/01"), { hintsShown: increment(1) }));
  await assertFails(updateDoc(doc(a, "missions/01"), { hintsShown: increment(1) }));
});

test("renouveler la clé coupe l'accès des anciens joueurs", async () => {
  const a = as("p1"); await join(a, "p1");
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "config/public"), { epoch: 2 });
    await setDoc(doc(db, "secrets/access"), { hash: sha("CLETEST02") });
  });
  await assertFails(getDocs(collection(a, "progress")));
  await assertFails(join(a, "p1", "CLETEST01", 2));
  await assertSucceeds(join(a, "p1", "CLETEST02", 2));
});

test("admin : tout gérer ; joueur : rien administrer", async () => {
  const adm = as("boss"), p = as("p1"); await join(p, "p1");
  await assertSucceeds(setDoc(doc(adm, "answers/01"), { hashes: [sha("X")] }));
  await assertSucceeds(getDoc(doc(adm, "answers/01")));
  await assertSucceeds(setDoc(doc(adm, "progress/02"), { answer: "MANUEL", at: serverTimestamp(), by: "boss", name: "L’ORDRE" }));
  await assertSucceeds(deleteDoc(doc(adm, "progress/02")));
  await assertSucceeds(getDocs(collection(adm, "players")));
  await assertFails(setDoc(doc(p, "config/public"), { epoch: 9 }));
  await assertFails(setDoc(doc(p, "admins/p1"), { nom: "moi" }));
  await assertFails(getDocs(collection(p, "players")));
});
