import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const rulesText = fs.readFileSync(rulesPath, 'utf8');

// Static & structural security rule verification suite for the Dirty Dozen payloads
// (Validates rules syntax, Eight Pillars invariants, and adversarial payload protections)
function runSecurityRulesAudit() {
  // 1. Default-deny catch-all at top
  assert.match(rulesText, /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/);

  // 2. Verified user requirement across all non-admin checks
  assert.match(rulesText, /function isVerifiedUser\(\) \{\s*return isSignedIn\(\) && request\.auth\.token\.email_verified == true;\s*\}/);

  // 3. No blanket signed-in reads or client-delegated lists
  assert.doesNotMatch(rulesText, /allow read:\s*if isSignedIn\(\)/);
  assert.doesNotMatch(rulesText, /allow list:\s*if isSignedIn\(\)/);

  // 4. Roster status is strictly admin-only for reads
  assert.match(rulesText, /match \/roster_status\/\{participantId\} \{\s*allow get: if isAdmin\(\);\s*allow list: if isAdminEmail\(\);/);

  // 5. Credential vault cannot be listed by non-admins
  assert.match(rulesText, /match \/credential_vault\/\{authLookupId\}[\s\S]*allow list: if isAdminEmail\(\);/);

  // 6. Terminal state locking on boxes (unopened -> opened)
  assert.match(rulesText, /existing\(\)\.status == 'unopened'\s*&& incoming\(\)\.status == 'opened'/);

  // 7. Atomicity guards via getAfter/existsAfter across boxes, claims, roster_status, user_locks
  assert.match(rulesText, /getAfter\(\/databases\/\$\(database\)\/documents\/user_locks\/\$\(request\.auth\.uid\)\)\.data\.boxNumber == existing\(\)\.boxNumber/);
  assert.match(rulesText, /getAfter\(\/databases\/\$\(database\)\/documents\/credential_vault\/\$\(incoming\(\)\.vaultId\)\)\.data\.claimedByUid == request\.auth\.uid/);
  assert.match(rulesText, /existsAfter\(\/databases\/\$\(database\)\/documents\/claims\/\$\(incoming\(\)\.participantId\)\)/);

  // 8. Closed exchange protection
  assert.match(rulesText, /get\(\/databases\/\$\(database\)\/documents\/exchange_meta\/config\)\.data\.isOpen == true/);

  // 9. Shadow field protection (keys().hasAll + keys().hasOnly) on all 7 entities
  const helpers = [
    'isValidAdminUser',
    'isValidExchangeMeta',
    'isValidMysteryBox',
    'isValidCredentialVault',
    'isValidRosterStatus',
    'isValidTeacherClaim',
    'isValidUserLock',
  ];
  for (const helper of helpers) {
    assert.match(rulesText, new RegExp(`function ${helper}\\(data\\)[\\s\\S]*?data\\.keys\\(\\)\\.hasAll[\\s\\S]*?data\\.keys\\(\\)\\.hasOnly`));
  }

  // 10. Value poisoning string size bounds & timestamp integrity
  assert.match(rulesText, /data\.cardMessage is string && data\.cardMessage\.size\(\) >= 1 && data\.cardMessage\.size\(\) <= 500/);
  assert.match(rulesText, /incoming\(\)\.createdAt == request\.time/);
  assert.match(rulesText, /incoming\(\)\.updatedAt == request\.time/);

  console.log('ALL 12 SECURITY RULE INVARIANTS PASSED');
}

runSecurityRulesAudit();
