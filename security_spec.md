# Security Specification — The Christmas Gift Exchange

## Phase 0: Data Invariants

1. **Default-Deny Baseline**: Every path not explicitly matched is denied (`match /{document=**} { allow read, write: if false; }`).
2. **Verified Authentication**: All standard reads and writes require `request.auth != null && request.auth.token.email_verified == true`.
3. **Admin Isolation**: Only the bootstrapped organiser (`orevabrown@gmail.com` with verified email) or users listed in `/admins/{uid}` may write `/exchange_meta`, create/delete `/roster_status`, `/credential_vault`, `/boxes`, or read the full roster/list collections.
4. **Zero Assignment Leakage**:
   - No participant may list `/credential_vault`, `/roster_status`, `/claims`, `/user_locks`, or `/boxes`.
   - `/roster_status` is completely unreadable by non-admins (`allow read: if isAdmin()`).
   - `/claims/{participantId}` is readable only by its `ownerUid` or an admin.
   - `/credential_vault/{authLookupId}` stores only AES-256-GCM encrypted recipient ciphertext (`encryptedRecipient`), never plaintext names, and cannot be read once `claimedByUid` is bound to a different UID.
5. **One Draw Per Teacher & Per Account**:
   - `/user_locks/{uid}` prevents any authenticated user from claiming more than one teacher slot.
   - `/claims/{participantId}` prevents any teacher slot from being claimed twice.
   - `/boxes/{boxId}` enforces Terminal State Locking (`existing().status == 'unopened' -> incoming().status == 'opened'`).
6. **Exchange Gate & Atomicity**:
   - Teachers can only open boxes or create claims while `/exchange_meta/config.isOpen == true`.
   - Opening a box in `/boxes/{boxId}` requires `existsAfter(/databases/$(database)/documents/user_locks/$(request.auth.uid))` in the same atomic commit.
   - Updating `/roster_status/{participantId}` requires `existsAfter(/databases/$(database)/documents/claims/$(participantId))` in the same atomic commit.
7. **Strict Schema & Temporal Integrity**:
   - Every string field enforces `.size()` limits matching `firebase-blueprint.json`.
   - Every `create` verifies `keys().hasAll(...) && keys().hasOnly(...)` and `createdAt == request.time`.
   - Every `update` validates `isValid[Entity](incoming())`, uses `affectedKeys().hasOnly(...)`, preserves immutable fields, and enforces `updatedAt == request.time`.

## The "Dirty Dozen" Adversarial Payloads

1. **Unauthenticated Box Open**: `request.auth == null` attempting `UPDATE /boxes/box_01` -> `PERMISSION_DENIED`.
2. **Unverified Email Impersonation**: `request.auth.token.email == 'orevabrown@gmail.com'` with `email_verified == false` attempting `CREATE /exchange_meta/config` -> `PERMISSION_DENIED`.
3. **Roster Scraping (`list`)**: Authenticated non-admin attempting `LIST /roster_status` -> `PERMISSION_DENIED`.
4. **Other Teacher Claim Snooping (`get`)**: Teacher B (`uid_B`) attempting `GET /claims/teacher_01` (owned by `uid_A`) -> `PERMISSION_DENIED`.
5. **Credential Vault Enumeration (`list`)**: Authenticated non-admin attempting `LIST /credential_vault` -> `PERMISSION_DENIED`.
6. **Double Box Open (Terminal State Bypass)**: Teacher B attempting `UPDATE /boxes/box_01` when `status` is already `'opened'` -> `PERMISSION_DENIED`.
7. **Box Hijack without User Lock (Sync Vulnerability)**: Teacher A attempting `UPDATE /boxes/box_02` without creating `/user_locks/{uid_A}` in the same atomic batch -> `PERMISSION_DENIED`.
8. **Impersonating Another UID on Claim**: Teacher B (`uid_B`) attempting `CREATE /claims/teacher_02` with `ownerUid: 'uid_A'` -> `PERMISSION_DENIED`.
9. **Closed Exchange Bypass**: Teacher A attempting `CREATE /claims/teacher_03` when `/exchange_meta/config.isOpen == false` -> `PERMISSION_DENIED`.
10. **Shadow / Ghost Field Injection**: Teacher A attempting `CREATE /user_locks/uid_A` with extra field `isAdmin: true` -> `PERMISSION_DENIED`.
11. **Value Poisoning (100KB String)**: Teacher A attempting `CREATE /claims/teacher_04` with `cardMessage` of length 2000 (> 500 max) -> `PERMISSION_DENIED`.
12. **Client-Forged Timestamp**: Teacher A attempting `CREATE /user_locks/uid_A` with `createdAt` != `request.time` -> `PERMISSION_DENIED`.
