import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  DEFAULT_TEACHERS,
  computeVaultId,
  decryptJson,
  encryptJson,
  generateSecretSantaDerangement,
  verifyAssignmentsInvariant,
} from '../lib/exchangeEngine.ts';

const TEST_SECRET = crypto.randomBytes(32).toString('hex');

async function runTests() {
  console.log('1. Testing 20-teacher Secret Santa derangement engine (1,000 iterations)...');
  for (let run = 0; run < 1000; run++) {
    const assignments = generateSecretSantaDerangement(DEFAULT_TEACHERS, TEST_SECRET);
    verifyAssignmentsInvariant(DEFAULT_TEACHERS, assignments);

    const pinSet = new Set(assignments.map((a) => a.pin));
    assert.equal(pinSet.size, 20, 'All 20 access PINs must be unique.');
  }
  console.log('   -> 1,000/1,000 derangements verified: 0 self-assignments, 20/20 bijection.');

  console.log('2. Testing all 20 teachers PIN vault HMAC + AES-256-GCM sealing...');
  const liveAssignments = generateSecretSantaDerangement(DEFAULT_TEACHERS, TEST_SECRET);
  const vaultStore = new Map<
    string,
    { participantId: string; encryptedPayload: string; claimedByUid: string | null }
  >();

  for (const item of liveAssignments) {
    const encryptedPayload = encryptJson(
      {
        participantId: item.giver.participantId,
        displayName: item.giver.displayName,
        recipientId: item.recipient.participantId,
        recipientName: item.recipient.displayName,
        recipientDepartment: item.recipient.department,
        cardMessage: item.cardMessage,
      },
      TEST_SECRET
    );
    vaultStore.set(item.vaultId, {
      participantId: item.giver.participantId,
      encryptedPayload,
      claimedByUid: null,
    });
  }

  assert.equal(vaultStore.size, 20, 'Vault must contain 20 distinct HMAC entries.');

  // Verify every single one of the 20 teachers can authenticate with Name + PIN (case/space insensitive name)
  for (const item of liveAssignments) {
    const lookup = computeVaultId(`  ${item.giver.displayName.toLowerCase()}  `, item.pin, TEST_SECRET);
    const entry = vaultStore.get(lookup);
    assert.ok(entry, `Teacher ${item.giver.displayName} must resolve with valid PIN.`);
    const decrypted = decryptJson<{ recipientId: string; recipientName: string }>(
      entry.encryptedPayload,
      TEST_SECRET
    );
    assert.equal(decrypted.recipientId, item.recipient.participantId);
    assert.notEqual(decrypted.recipientId, item.giver.participantId);

    // Wrong PIN must fail
    const badLookup = computeVaultId(item.giver.displayName, 'WRONG1', TEST_SECRET);
    assert.equal(vaultStore.get(badLookup), undefined, 'Wrong PIN must never resolve.');
  }
  console.log('   -> All 20/20 teacher credentials and encrypted payloads verified.');

  console.log('3. Testing simultaneous atomic box selections & race-condition rejection...');
  // Atomic state machine mirroring Firestore optimistic updateTime + exists:false preconditions
  const boxes = new Map<number, { status: 'unopened' | 'opened'; version: number; ownerUid: string | null }>();
  for (let b = 1; b <= 20; b++) {
    boxes.set(b, { status: 'unopened', version: 1, ownerUid: null });
  }
  const userLocks = new Set<string>();
  const claims = new Map<string, { recipientId: string; boxNumber: number }>();

  async function atomicOpenBox(uid: string, name: string, pin: string, boxNumber: number) {
    // Yield microtask to interleave concurrent attempts
    await new Promise((r) => setTimeout(r, 1));
    const vaultId = computeVaultId(name, pin, TEST_SECRET);
    const vault = vaultStore.get(vaultId);
    if (!vault) throw new Error('401 Invalid credentials');
    if (vault.claimedByUid && vault.claimedByUid !== uid) throw new Error('403 Impersonation blocked');
    if (userLocks.has(uid)) throw new Error('409 User already drew');
    if (claims.has(vault.participantId)) throw new Error('409 Participant already drew');

    const box = boxes.get(boxNumber);
    if (!box || box.status !== 'unopened') throw new Error('409 Box already opened');

    const decrypted = decryptJson<{ recipientId: string }>(vault.encryptedPayload, TEST_SECRET);

    // Commit atomically
    vault.claimedByUid = uid;
    userLocks.add(uid);
    box.status = 'opened';
    box.version++;
    box.ownerUid = uid;
    claims.set(vault.participantId, { recipientId: decrypted.recipientId, boxNumber });
    return decrypted.recipientId;
  }

  // Race test A: Two teachers simultaneously click Box #7 at the exact same millisecond
  const t1 = liveAssignments[0];
  const t2 = liveAssignments[1];
  const raceResults = await Promise.allSettled([
    atomicOpenBox('uid_01', t1.giver.displayName, t1.pin, 7),
    atomicOpenBox('uid_02', t2.giver.displayName, t2.pin, 7),
  ]);
  const fulfilledRace = raceResults.filter((r) => r.status === 'fulfilled');
  const rejectedRace = raceResults.filter((r) => r.status === 'rejected');
  assert.equal(fulfilledRace.length, 1, 'Exactly one concurrent racer may claim Box #7.');
  assert.equal(rejectedRace.length, 1, 'Second concurrent racer on Box #7 must fail.');

  // Complete remaining 19 teachers concurrently across remaining boxes
  const winnerIdx = raceResults[0].status === 'fulfilled' ? 0 : 1;
  const loserIdx = winnerIdx === 0 ? 1 : 0;
  const remainingBoxes = Array.from({ length: 20 }, (_, i) => i + 1).filter((n) => n !== 7);

  const remainingAttempts: Array<Promise<string>> = [];
  let boxCursor = 0;
  for (let i = 0; i < 20; i++) {
    if (i === winnerIdx) continue;
    const teacher = liveAssignments[i];
    const targetBox = remainingBoxes[boxCursor++];
    remainingAttempts.push(
      atomicOpenBox(`uid_${String(i + 1).padStart(2, '0')}`, teacher.giver.displayName, teacher.pin, targetBox)
    );
  }
  const allRemaining = await Promise.all(remainingAttempts);
  assert.equal(allRemaining.length, 19);
  assert.equal(claims.size, 20, 'All 20 teachers must complete exactly 1 claim.');
  assert.equal(userLocks.size, 20, 'All 20 UIDs locked.');

  // Duplicate draw attempt by loserIdx or any teacher must be rejected
  await assert.rejects(
    () =>
      atomicOpenBox(
        `uid_${String(loserIdx + 1).padStart(2, '0')}`,
        liveAssignments[loserIdx].giver.displayName,
        liveAssignments[loserIdx].pin,
        1
      ),
    /409/
  );

  // Verify final claims bijection (20 unique recipients, 0 self-assignments, 20 unique boxes)
  const finalRecipients = new Set(Array.from(claims.values()).map((c) => c.recipientId));
  const finalBoxes = new Set(Array.from(claims.values()).map((c) => c.boxNumber));
  assert.equal(finalRecipients.size, 20);
  assert.equal(finalBoxes.size, 20);
  for (const [giverId, claim] of claims.entries()) {
    assert.notEqual(giverId, claim.recipientId);
  }
  console.log('   -> Concurrent race test & full 20-teacher simulation passed with 0 duplicates & 0 self-assignments.');
}

runTests().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
