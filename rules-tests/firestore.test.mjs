// Firestore 權限規則測試：npm run test:rules（需要 Java，會啟動本機模擬器）
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, Bytes } from 'firebase/firestore';
import { encode } from '../js/lib/fsCodec.js';

const OWNER = 'ben901227@gmail.com';
const ADMIN = 'admin2@example.com';
const MEMBER = 'member@example.com';
const STRANGER = 'stranger@example.com';

let env;
const as = (email, verified = true) => env.authenticatedContext(email, { email, email_verified: verified }).firestore();
const caseData = { id: 'c1', meta: { name: '測試案' } };
const bytes = (n) => Bytes.fromUint8Array(new Uint8Array(n));

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rescue',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 },
  });
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'members', ADMIN), { role: 'admin' });
    await setDoc(doc(db, 'members', MEMBER), { role: 'member' });
    await setDoc(doc(db, 'cases', 'c1'), caseData);
    await setDoc(doc(db, 'logs', 'member-dev1'), { account: MEMBER, text: 'x' });
  });
});

test('未登入、非成員、email 未驗證都讀不到案件', async () => {
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'cases', 'c1')));
  await assertFails(getDoc(doc(as(STRANGER), 'cases', 'c1')));
  await assertFails(getDoc(doc(as(MEMBER, false), 'cases', 'c1')));
});

test('成員可讀寫案件，但不能刪除；管理員可刪除', async () => {
  await assertSucceeds(getDoc(doc(as(MEMBER), 'cases', 'c1')));
  await assertSucceeds(setDoc(doc(as(MEMBER), 'cases', 'c2'), { id: 'c2', meta: { name: '新案' } }));
  await assertFails(setDoc(doc(as(MEMBER), 'cases', 'c3'), { id: 'wrong', meta: { name: 'x' } }));
  await assertFails(deleteDoc(doc(as(MEMBER), 'cases', 'c1')));
  await assertSucceeds(deleteDoc(doc(as(ADMIN), 'cases', 'c1')));
});

test('第一位管理員不在名單內也有權限', async () => {
  await assertSucceeds(getDoc(doc(as(OWNER), 'cases', 'c1')));
  await assertSucceeds(setDoc(doc(as(OWNER), 'members', 'new@example.com'), { role: 'member' }));
});

test('只有管理員能改成員名單，且不能動到第一位管理員', async () => {
  await assertFails(setDoc(doc(as(MEMBER), 'members', STRANGER), { role: 'member' }));
  await assertFails(setDoc(doc(as(MEMBER), 'members', MEMBER), { role: 'admin' }));
  await assertSucceeds(setDoc(doc(as(ADMIN), 'members', STRANGER), { role: 'member' }));
  await assertFails(setDoc(doc(as(ADMIN), 'members', 'x@example.com'), { role: 'boss' }));
  await assertFails(deleteDoc(doc(as(ADMIN), 'members', OWNER)));
  await assertSucceeds(getDoc(doc(as(MEMBER), 'members', MEMBER)));
  await assertFails(getDoc(doc(as(MEMBER), 'members', ADMIN)));
});

test('被移出名單後立刻讀不到', async () => {
  await assertSucceeds(deleteDoc(doc(as(ADMIN), 'members', MEMBER)));
  await assertFails(getDoc(doc(as(MEMBER), 'cases', 'c1')));
});

test('路線至少兩點', async () => {
  const ref = doc(as(MEMBER), 'cases', 'c1', 'routes', 'r1');
  await assertSucceeds(setDoc(ref, encode({ name: 'A', points: [[23.9, 121.3], [23.91, 121.31]] })));
  await assertFails(setDoc(ref, encode({ name: 'A', points: [[23.9, 121.3]] })));
});

test('照片大小限制、只能用自己的名義上傳、只能刪自己的', async () => {
  const ref = (who) => doc(as(who), 'cases', 'c1', 'photos', 'p1');
  await assertFails(setDoc(ref(MEMBER), { image: bytes(800 * 1024), thumb: bytes(10), by: MEMBER }));
  await assertFails(setDoc(ref(MEMBER), { image: bytes(1000), thumb: bytes(10), by: ADMIN }));
  await assertSucceeds(setDoc(ref(MEMBER), { image: bytes(300 * 1024), thumb: bytes(20 * 1024), by: MEMBER, caption: 'a' }));
  await assertFails(deleteDoc(doc(as(ADMIN.replace('admin2', 'other')), 'cases', 'c1', 'photos', 'p1')));
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'members', 'm2@example.com'), { role: 'member' }));
  await assertFails(deleteDoc(doc(as('m2@example.com'), 'cases', 'c1', 'photos', 'p1')));
  await assertSucceeds(deleteDoc(doc(as(MEMBER), 'cases', 'c1', 'photos', 'p1')));
});

test('握手範圍：成員可讀、可新增，只有管理員能刪除，不能修改', async () => {
  const data = (by, n = 10) => ({ name: '台A', source: 'import', grid: { x0: 0, y0: 0, cell: 20, w: 1, h: 1 }, mask: bytes(n), by, created: 'x' });
  const ref = (who, id = 'h1') => doc(as(who), 'cases', 'c1', 'handshakes', id);
  await assertSucceeds(setDoc(ref(MEMBER, 'hm'), data(MEMBER)));
  await assertFails(setDoc(ref(STRANGER, 'hs'), data(STRANGER)));
  await assertSucceeds(setDoc(ref(ADMIN), data(ADMIN)));
  await assertSucceeds(getDoc(ref(MEMBER)));
  await assertFails(getDoc(ref(STRANGER)));
  await assertFails(setDoc(ref(ADMIN, 'h2'), data(MEMBER)));
  await assertFails(setDoc(ref(ADMIN, 'h3'), data(ADMIN, 701 * 1024)));
  await assertFails(setDoc(ref(ADMIN), { ...data(ADMIN), name: '改名' }));
  await assertFails(deleteDoc(ref(MEMBER)));
  await assertSucceeds(deleteDoc(ref(ADMIN)));
});

test('使用記錄：只能寫自己的；隊員看不到別人的，管理員看得到全部', async () => {
  await assertSucceeds(setDoc(doc(as(MEMBER), 'logs', 'member-dev2'), { account: MEMBER, text: 'hi' }));
  await assertFails(setDoc(doc(as(MEMBER), 'logs', 'fake'), { account: ADMIN, text: 'hi' }));
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'members', 'm2@example.com'), { role: 'member' }));
  await assertFails(setDoc(doc(as('m2@example.com'), 'logs', 'member-dev1'), { account: 'm2@example.com', text: 'overwrite' }));
  await assertFails(getDoc(doc(as('m2@example.com'), 'logs', 'member-dev1')));
  await assertSucceeds(getDoc(doc(as(MEMBER), 'logs', 'member-dev1')));
  await assertSucceeds(getDoc(doc(as(ADMIN), 'logs', 'member-dev1')));
});
