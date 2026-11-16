import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import {
  DEFAULT_TEACHERS,
  computeVaultId,
  decryptJson,
  encryptJson,
  generateAccessPin,
  generateSecretSantaDerangement,
  normalizeTeacherName,
  verifyAssignmentsInvariant,
  type TeacherSeed,
} from './lib/exchangeEngine.ts';

dotenv.config();

interface FirebaseAppletConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId: string;
}

const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
const firebaseConfig: FirebaseAppletConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const ADMIN_EMAIL = 'orevabrown@gmail.com';

function deriveSecretKeyHex(): string {
  const rawSecret =
    process.env.EXCHANGE_SECRET && process.env.EXCHANGE_SECRET.trim().length >= 16
      ? process.env.EXCHANGE_SECRET.trim()
      : `${firebaseConfig.apiKey}:${firebaseConfig.appId}:${firebaseConfig.firestoreDatabaseId}:christmas-gift-exchange-2026`;
  return crypto.createHash('sha256').update(rawSecret).digest('hex');
}

const SECRET_KEY_HEX = deriveSecretKeyHex();

const FIRESTORE_DOC_BASE = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents`;
const FIRESTORE_DOC_PATH_PREFIX = `projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents`;

// --- Firebase ID Token Verification (via Google's public X.509 certificates) ---
interface CertCache {
  certs: Record<string, string>;
  expiresAt: number;
}
let certCache: CertCache = { certs: {}, expiresAt: 0 };

async function getFirebasePublicCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (now < certCache.expiresAt && Object.keys(certCache.certs).length > 0) {
    return certCache.certs;
  }
  const res = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  if (!res.ok) {
    throw new Error('Failed to fetch Firebase public verification certificates.');
  }
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAgeMs = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : 300_000;
  const certs = (await res.json()) as Record<string, string>;
  certCache = { certs, expiresAt: now + maxAgeMs };
  return certs;
}

function base64UrlDecode(str: string): Buffer {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(str.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  idToken: string;
}

async function verifyFirebaseIdToken(authHeader: string | undefined): Promise<VerifiedFirebaseUser> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new HttpError(401, 'Missing authentication token. Please sign in with Google.');
  }
  const idToken = authHeader.slice('Bearer '.length).trim();
  const segments = idToken.split('.');
  if (segments.length !== 3) {
    throw new HttpError(401, 'Malformed authentication token.');
  }
  const [headerB64, payloadB64, sigB64] = segments;
  const header = JSON.parse(base64UrlDecode(headerB64).toString('utf8')) as { alg?: string; kid?: string };
  const payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8')) as {
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    email?: string;
    email_verified?: boolean;
  };

  if (header.alg !== 'RS256' || !header.kid) {
    throw new HttpError(401, 'Unsupported token algorithm.');
  }

  const certs = await getFirebasePublicCerts();
  const cert = certs[header.kid];
  if (!cert) {
    throw new HttpError(401, 'Token key ID not recognized.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const signature = base64UrlDecode(sigB64);
  if (!verifier.verify(cert, signature)) {
    throw new HttpError(401, 'Invalid token signature.');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== firebaseConfig.projectId) {
    throw new HttpError(401, 'Token audience mismatch.');
  }
  if (payload.iss !== `https://securetoken.google.com/${firebaseConfig.projectId}`) {
    throw new HttpError(401, 'Token issuer mismatch.');
  }
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new HttpError(401, 'Token missing subject.');
  }
  if (!payload.exp || payload.exp <= nowSec) {
    throw new HttpError(401, 'Authentication session expired. Please refresh and sign in again.');
  }
  if (!payload.email_verified || !payload.email) {
    throw new HttpError(403, 'Verified Google email is required.');
  }

  return {
    uid: payload.sub,
    email: payload.email,
    emailVerified: Boolean(payload.email_verified),
    idToken,
  };
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// --- Firestore REST API Helpers ---
type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { timestampValue: string }
  | { mapValue: { fields: Record<string, FirestoreValue> } };

interface FirestoreRawDoc {
  name: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
}

function toFirestoreValue(val: unknown): FirestoreValue {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    return { integerValue: String(Math.trunc(val)) };
  }
  if (val instanceof Date) {
    return { timestampValue: val.toISOString() };
  }
  if (typeof val === 'object') {
    const fields: Record<string, FirestoreValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  throw new Error(`Unsupported Firestore value type: ${typeof val}`);
}

function toFirestoreFields(obj: Record<string, unknown>): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    fields[k] = toFirestoreValue(v);
  }
  return fields;
}

function fromFirestoreValue(val: FirestoreValue): unknown {
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('mapValue' in val) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      out[k] = fromFirestoreValue(v);
    }
    return out;
  }
  return null;
}

function parseFirestoreDoc<T>(doc: FirestoreRawDoc): T & { _updateTime?: string; _id: string } {
  const out: Record<string, unknown> = {};
  if (doc.fields) {
    for (const [k, v] of Object.entries(doc.fields)) {
      out[k] = fromFirestoreValue(v);
    }
  }
  const parts = doc.name.split('/');
  out._id = parts[parts.length - 1];
  if (doc.updateTime) {
    out._updateTime = doc.updateTime;
  }
  return out as T & { _updateTime?: string; _id: string };
}

async function firestoreGet<T>(docPath: string, idToken: string): Promise<(T & { _updateTime?: string; _id: string }) | null> {
  const res = await fetch(`${FIRESTORE_DOC_BASE}/${docPath}?key=${firebaseConfig.apiKey}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 403) {
      throw new HttpError(403, `Firestore permission denied on ${docPath}: ${body}`);
    }
    throw new Error(`Firestore GET ${docPath} failed (${res.status}): ${body}`);
  }
  const raw = (await res.json()) as FirestoreRawDoc;
  return parseFirestoreDoc<T>(raw);
}

async function firestoreBatchGet<T>(
  docPaths: string[],
  idToken: string
): Promise<Array<(T & { _updateTime?: string; _id: string }) | null>> {
  const res = await fetch(`${FIRESTORE_DOC_BASE}:batchGet?key=${firebaseConfig.apiKey}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      documents: docPaths.map((p) => `${FIRESTORE_DOC_PATH_PREFIX}/${p}`),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firestore batchGet failed (${res.status}): ${body}`);
  }
  const results = (await res.json()) as Array<{ found?: FirestoreRawDoc; missing?: string }>;
  const map = new Map<string, T & { _updateTime?: string; _id: string }>();
  for (const item of results) {
    if (item.found) {
      const rel = item.found.name.replace(`${FIRESTORE_DOC_PATH_PREFIX}/`, '');
      map.set(rel, parseFirestoreDoc<T>(item.found));
    }
  }
  return docPaths.map((p) => map.get(p) ?? null);
}

async function firestoreList<T>(collectionPath: string, idToken: string): Promise<Array<T & { _updateTime?: string; _id: string }>> {
  const docs: Array<T & { _updateTime?: string; _id: string }> = [];
  let pageToken: string | undefined;
  do {
    const qs = new URLSearchParams({ key: firebaseConfig.apiKey, pageSize: '200' });
    if (pageToken) qs.set('pageToken', pageToken);
    const res = await fetch(`${FIRESTORE_DOC_BASE}/${collectionPath}?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new HttpError(res.status === 403 ? 403 : 500, `Firestore LIST ${collectionPath} failed: ${body}`);
    }
    const json = (await res.json()) as { documents?: FirestoreRawDoc[]; nextPageToken?: string };
    for (const d of json.documents || []) {
      docs.push(parseFirestoreDoc<T>(d));
    }
    pageToken = json.nextPageToken;
  } while (pageToken);
  return docs;
}

interface FirestoreCommitWrite {
  update?: {
    name: string;
    fields: Record<string, FirestoreValue>;
  };
  delete?: string;
  updateMask?: { fieldPaths: string[] };
  updateTransforms?: Array<{ fieldPath: string; setToServerValue: 'REQUEST_TIME' }>;
  currentDocument?: { exists?: boolean; updateTime?: string };
}

async function firestoreCommit(writes: FirestoreCommitWrite[], idToken: string): Promise<void> {
  if (writes.length === 0) return;
  const res = await fetch(`${FIRESTORE_DOC_BASE}:commit?key=${firebaseConfig.apiKey}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ writes }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Firestore commit error (${res.status}):`, body);
    if (res.status === 409 || body.includes('FAILED_PRECONDITION') || body.includes('ABORTED') || body.includes('ALREADY_EXISTS')) {
      throw new HttpError(409, `Concurrent modification conflict: ${body}`);
    }
    if (res.status === 403) {
      throw new HttpError(403, `Firestore commit permission denied: ${body}`);
    }
    throw new Error(`Firestore commit failed (${res.status}): ${body}`);
  }
}

async function assertAdmin(user: VerifiedFirebaseUser): Promise<void> {
  if (user.email.toLowerCase() === ADMIN_EMAIL) {
    return;
  }
  const adminDoc = await firestoreGet<{ uid: string; email: string }>(`admins/${user.uid}`, user.idToken);
  if (!adminDoc) {
    throw new HttpError(403, 'Organiser privileges required.');
  }
}

function getRibbonStyle(boxNumber: number): 'burgundy' | 'gold' | 'forest' | 'ivory' {
  const styles: Array<'burgundy' | 'gold' | 'forest' | 'ivory'> = ['burgundy', 'gold', 'forest', 'ivory'];
  return styles[(boxNumber - 1) % styles.length];
}

// --- Express App ---
const app = express();
app.use(express.json({ limit: '1mb' }));

const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/workspace-pltawgpz\.v0\.build$/i,
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/i,
  /^https:\/\/[a-z0-9-]+\.v0\.build$/i,
  /^https:\/\/[a-z0-9-]+\.run\.app$/i,
  /^http:\/\/localhost(:\d+)?$/i,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/i,
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    projectId: firebaseConfig.projectId,
    databaseId: firebaseConfig.firestoreDatabaseId,
  });
});

interface BoxDoc {
  boxId: string;
  boxNumber: number;
  ribbonStyle: string;
  status: 'unopened' | 'opened';
  openedByUid: string | null;
  openedAt: string | null;
}

interface MetaDoc {
  title: string;
  tagline: string;
  isOpen: boolean;
  isInitialized: boolean;
  participantCount: number;
  adminEmail: string;
}

interface UserLockDoc {
  uid: string;
  participantId: string;
  boxNumber: number;
}

interface ClaimDoc {
  participantId: string;
  ownerUid: string;
  ownerEmail: string;
  vaultId: string;
  displayName: string;
  recipientName: string;
  recipientDepartment: string;
  boxNumber: number;
  cardMessage: string;
  createdAt: string;
}

interface VaultPayload {
  participantId: string;
  displayName: string;
  recipientId: string;
  recipientName: string;
  recipientDepartment: string;
  cardMessage: string;
}

interface VaultDoc {
  authLookupId: string;
  participantId: string;
  encryptedPayload: string;
  claimedByUid: string | null;
}

interface RosterDoc {
  participantId: string;
  displayName: string;
  department: string;
  vaultId: string;
  encryptedPin: string;
  hasParticipated: boolean;
  selectedBoxNumber: number | null;
  claimedByUid: string | null;
  participatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Fetch live state for a signed-in user (never exposes other teachers' assignments)
app.get('/api/exchange/state', async (req, res) => {
  try {
    const user = await verifyFirebaseIdToken(req.headers.authorization);
    const boxPaths = Array.from({ length: 20 }, (_, i) => `boxes/box_${String(i + 1).padStart(2, '0')}`);
    const [meta, userLock, ...boxes] = await firestoreBatchGet<any>(
      ['exchange_meta/config', `user_locks/${user.uid}`, ...boxPaths],
      user.idToken
    );

    let existingClaim: ClaimDoc | null = null;
    if (userLock && (userLock as UserLockDoc).participantId) {
      existingClaim = await firestoreGet<ClaimDoc>(
        `claims/${(userLock as UserLockDoc).participantId}`,
        user.idToken
      );
    }

    const sanitizedBoxes = (boxes as Array<(BoxDoc & { _id: string }) | null>)
      .filter((b): b is BoxDoc & { _id: string } => b !== null)
      .map((b) => ({
        boxId: b.boxId,
        boxNumber: b.boxNumber,
        ribbonStyle: b.ribbonStyle,
        status: b.status,
        isMine: b.openedByUid === user.uid,
      }))
      .sort((a, b) => a.boxNumber - b.boxNumber);

    const isAdmin =
      user.email.toLowerCase() === ADMIN_EMAIL ||
      Boolean(await firestoreGet(`admins/${user.uid}`, user.idToken));

    res.json({
      meta: meta
        ? {
            title: (meta as MetaDoc).title,
            tagline: (meta as MetaDoc).tagline,
            isOpen: (meta as MetaDoc).isOpen,
            isInitialized: (meta as MetaDoc).isInitialized,
            participantCount: (meta as MetaDoc).participantCount,
          }
        : null,
      boxes: sanitizedBoxes,
      existingClaim,
      isAdmin,
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to load exchange state.' });
  }
});

// Verify teacher Name + Access PIN without revealing recipient before box selection
app.post('/api/auth/verify-pin', async (req, res) => {
  try {
    const user = await verifyFirebaseIdToken(req.headers.authorization);
    const { name, pin } = req.body as { name?: string; pin?: string };

    if (!name || typeof name !== 'string' || !pin || typeof pin !== 'string') {
      throw new HttpError(400, 'Please enter both your registered name and access PIN.');
    }

    const meta = await firestoreGet<MetaDoc>('exchange_meta/config', user.idToken);
    if (!meta || !meta.isInitialized) {
      throw new HttpError(400, 'The Christmas Gift Exchange has not been initialized by the organiser yet.');
    }

    // Check if this Google user already completed their draw
    const existingLock = await firestoreGet<UserLockDoc>(`user_locks/${user.uid}`, user.idToken);
    if (existingLock) {
      const existingClaim = await firestoreGet<ClaimDoc>(`claims/${existingLock.participantId}`, user.idToken);
      if (existingClaim) {
        return res.json({
          status: 'already_completed',
          claim: existingClaim,
        });
      }
    }

    if (!meta.isOpen) {
      throw new HttpError(403, 'Participation is currently closed by the organiser.');
    }

    const vaultId = computeVaultId(name, pin, SECRET_KEY_HEX);
    let vaultDoc: (VaultDoc & { _updateTime?: string }) | null = null;
    try {
      vaultDoc = await firestoreGet<VaultDoc>(`credential_vault/${vaultId}`, user.idToken);
    } catch (err) {
      if (err instanceof HttpError && err.status === 403) {
        throw new HttpError(403, 'This teacher slot has already been claimed by another signed-in account.');
      }
      throw err;
    }

    if (!vaultDoc) {
      throw new HttpError(401, 'Registered name or access PIN did not match our faculty list. Please check your details.');
    }

    if (vaultDoc.claimedByUid && vaultDoc.claimedByUid !== user.uid) {
      throw new HttpError(403, 'This teacher slot is already claimed by another account.');
    }

    // Also verify whether this participantId already completed a draw
    const existingParticipantClaim = await firestoreGet<ClaimDoc>(`claims/${vaultDoc.participantId}`, user.idToken).catch(
      () => null
    );
    if (existingParticipantClaim) {
      return res.json({
        status: 'already_completed',
        claim: existingParticipantClaim,
      });
    }

    const payload = decryptJson<VaultPayload>(vaultDoc.encryptedPayload, SECRET_KEY_HEX);

    res.json({
      status: 'ready_to_draw',
      participantId: payload.participantId,
      displayName: payload.displayName,
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Credential validation failed.' });
  }
});

// Atomic mystery gift box selection & reveal
app.post('/api/exchange/open-box', async (req, res) => {
  try {
    const user = await verifyFirebaseIdToken(req.headers.authorization);
    const { name, pin, boxNumber } = req.body as { name?: string; pin?: string; boxNumber?: number };

    if (!name || typeof name !== 'string' || !pin || typeof pin !== 'string') {
      throw new HttpError(400, 'Missing teacher credentials.');
    }
    if (typeof boxNumber !== 'number' || !Number.isInteger(boxNumber) || boxNumber < 1 || boxNumber > 20) {
      throw new HttpError(400, 'Please select a valid mystery gift box (1–20).');
    }

    const meta = await firestoreGet<MetaDoc>('exchange_meta/config', user.idToken);
    if (!meta || !meta.isInitialized) {
      throw new HttpError(400, 'Exchange is not initialized.');
    }

    // Return existing claim if already drawn
    const existingLock = await firestoreGet<UserLockDoc>(`user_locks/${user.uid}`, user.idToken);
    if (existingLock) {
      const existingClaim = await firestoreGet<ClaimDoc>(`claims/${existingLock.participantId}`, user.idToken);
      if (existingClaim) {
        return res.json({ status: 'already_completed', claim: existingClaim });
      }
    }

    if (!meta.isOpen) {
      throw new HttpError(403, 'Participation has been closed by the organiser.');
    }

    const vaultId = computeVaultId(name, pin, SECRET_KEY_HEX);
    const vaultDoc = await firestoreGet<VaultDoc>(`credential_vault/${vaultId}`, user.idToken);
    if (!vaultDoc) {
      throw new HttpError(401, 'Invalid teacher name or access PIN.');
    }
    if (vaultDoc.claimedByUid && vaultDoc.claimedByUid !== user.uid) {
      throw new HttpError(403, 'This teacher identity is locked to another user.');
    }

    const boxId = `box_${String(boxNumber).padStart(2, '0')}`;
    const boxDoc = await firestoreGet<BoxDoc>(`boxes/${boxId}`, user.idToken);
    if (!boxDoc) {
      throw new HttpError(404, 'Mystery gift box not found.');
    }
    if (boxDoc.status !== 'unopened') {
      throw new HttpError(409, `Gift Box #${boxNumber} has already been opened by a colleague! Please pick another unopened box.`);
    }

    const payload = decryptJson<VaultPayload>(vaultDoc.encryptedPayload, SECRET_KEY_HEX);

    // Execute atomic 5-document Firestore commit with optimistic preconditions
    const writes: FirestoreCommitWrite[] = [
      // 1. Bind credential_vault to this user UID
      {
        update: {
          name: `${FIRESTORE_DOC_PATH_PREFIX}/credential_vault/${vaultId}`,
          fields: toFirestoreFields({
            claimedByUid: user.uid,
          }),
        },
        updateMask: { fieldPaths: ['claimedByUid'] },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { updateTime: vaultDoc._updateTime },
      },
      // 2. Create private revealed claim (must not exist yet)
      {
        update: {
          name: `${FIRESTORE_DOC_PATH_PREFIX}/claims/${payload.participantId}`,
          fields: toFirestoreFields({
            participantId: payload.participantId,
            ownerUid: user.uid,
            ownerEmail: user.email,
            vaultId,
            displayName: payload.displayName,
            recipientName: payload.recipientName,
            recipientDepartment: payload.recipientDepartment,
            boxNumber,
            cardMessage: payload.cardMessage,
          }),
        },
        updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { exists: false },
      },
      // 3. Create one-draw-per-user lock (must not exist yet)
      {
        update: {
          name: `${FIRESTORE_DOC_PATH_PREFIX}/user_locks/${user.uid}`,
          fields: toFirestoreFields({
            uid: user.uid,
            participantId: payload.participantId,
            boxNumber,
          }),
        },
        updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { exists: false },
      },
      // 4. Open the mystery gift box (updateTime precondition blocks concurrent double-open!)
      {
        update: {
          name: `${FIRESTORE_DOC_PATH_PREFIX}/boxes/${boxId}`,
          fields: toFirestoreFields({
            status: 'opened',
            openedByUid: user.uid,
          }),
        },
        updateMask: { fieldPaths: ['status', 'openedByUid'] },
        updateTransforms: [
          { fieldPath: 'openedAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ],
        currentDocument: { updateTime: boxDoc._updateTime },
      },
      // 5. Mark roster_status as participated for Organiser Dashboard
      {
        update: {
          name: `${FIRESTORE_DOC_PATH_PREFIX}/roster_status/${payload.participantId}`,
          fields: toFirestoreFields({
            hasParticipated: true,
            selectedBoxNumber: boxNumber,
            claimedByUid: user.uid,
          }),
        },
        updateMask: { fieldPaths: ['hasParticipated', 'selectedBoxNumber', 'claimedByUid'] },
        updateTransforms: [
          { fieldPath: 'participatedAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ],
        currentDocument: { exists: true },
      },
    ];

    try {
      await firestoreCommit(writes, user.idToken);
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) {
        throw new HttpError(
          409,
          `Gift Box #${boxNumber} was just claimed by another teacher at the exact same moment, or your draw already completed. Please refresh and choose another box.`
        );
      }
      throw err;
    }

    const createdClaim = await firestoreGet<ClaimDoc>(`claims/${payload.participantId}`, user.idToken);
    res.json({
      status: 'opened',
      claim: createdClaim || {
        participantId: payload.participantId,
        ownerUid: user.uid,
        ownerEmail: user.email,
        vaultId,
        displayName: payload.displayName,
        recipientName: payload.recipientName,
        recipientDepartment: payload.recipientDepartment,
        boxNumber,
        cardMessage: payload.cardMessage,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to open mystery gift box.' });
  }
});

// --- Organiser Admin Endpoints ---

async function fetchAllRosterDocs(idToken: string): Promise<Array<RosterDoc & { _id: string }>> {
  try {
    return await firestoreList<RosterDoc>('roster_status', idToken);
  } catch {
    const paths = Array.from({ length: 20 }, (_, i) => `roster_status/teacher_${String(i + 1).padStart(2, '0')}`);
    const docs = await firestoreBatchGet<RosterDoc>(paths, idToken);
    return docs.filter((d): d is RosterDoc & { _id: string } => d !== null);
  }
}

async function fetchAllBoxDocs(idToken: string): Promise<Array<BoxDoc & { _id: string }>> {
  try {
    return await firestoreList<BoxDoc>('boxes', idToken);
  } catch {
    const paths = Array.from({ length: 20 }, (_, i) => `boxes/box_${String(i + 1).padStart(2, '0')}`);
    const docs = await firestoreBatchGet<BoxDoc>(paths, idToken);
    return docs.filter((d): d is BoxDoc & { _id: string } => d !== null);
  }
}

app.get('/api/admin/dashboard', async (req, res) => {
  try {
    const user = await verifyFirebaseIdToken(req.headers.authorization);
    await assertAdmin(user);

    const [meta, rosterDocs, boxes] = await Promise.all([
      firestoreGet<MetaDoc>('exchange_meta/config', user.idToken),
      fetchAllRosterDocs(user.idToken),
      fetchAllBoxDocs(user.idToken),
    ]);

    const participants = rosterDocs
      .map((r) => {
        let pin = '******';
        try {
          const dec = decryptJson<{ pin: string }>(r.encryptedPin, SECRET_KEY_HEX);
          pin = dec.pin;
        } catch {
          pin = 'ERR';
        }
        return {
          participantId: r.participantId,
          displayName: r.displayName,
          department: r.department,
          pin,
          hasParticipated: r.hasParticipated,
          selectedBoxNumber: r.selectedBoxNumber,
          participatedAt: r.participatedAt,
        };
      })
      .sort((a, b) => a.participantId.localeCompare(b.participantId));

    const completedCount = participants.filter((p) => p.hasParticipated).length;

    res.json({
      meta,
      participants,
      stats: {
        total: participants.length,
        completed: completedCount,
        pending: participants.length - completedCount,
        boxesOpened: boxes.filter((b) => b.status === 'opened').length,
      },
      defaultTeachers: DEFAULT_TEACHERS,
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to load organiser dashboard.' });
  }
});

app.post('/api/admin/prepare-exchange', async (req, res) => {
  try {
    const user = await verifyFirebaseIdToken(req.headers.authorization);
    await assertAdmin(user);

    const { teachers: customTeachers } = (req.body || {}) as {
      teachers?: Array<{ displayName: string; department?: string }>;
    };

    let teacherList: TeacherSeed[] = DEFAULT_TEACHERS;
    if (Array.isArray(customTeachers) && customTeachers.length > 0) {
      if (customTeachers.length !== 20) {
        throw new HttpError(400, `Exactly 20 teachers are required (received ${customTeachers.length}).`);
      }
      teacherList = customTeachers.map((t, idx) => {
        const displayName = String(t.displayName || '').trim();
        const department = String(t.department || 'Faculty').trim() || 'Faculty';
        if (!displayName || displayName.length > 120) {
          throw new HttpError(400, `Invalid teacher name at row ${idx + 1}.`);
        }
        return {
          participantId: `teacher_${String(idx + 1).padStart(2, '0')}`,
          displayName,
          department: department.slice(0, 80),
        };
      });
    }

    const assignments = generateSecretSantaDerangement(teacherList, SECRET_KEY_HEX);

    const meta = {
      title: 'The Christmas Gift Exchange',
      tagline: 'A Little Gift, A Lot of Love.',
      isOpen: true,
      isInitialized: true,
      participantCount: teacherList.length,
      adminEmail: ADMIN_EMAIL,
    };

    const boxes = Array.from({ length: 20 }, (_, idx) => {
      const boxNumber = idx + 1;
      const boxId = `box_${String(boxNumber).padStart(2, '0')}`;
      return {
        boxId,
        boxNumber,
        ribbonStyle: getRibbonStyle(boxNumber),
        status: 'unopened' as const,
        openedByUid: null,
        openedAt: null,
      };
    });

    const vaults = assignments.map((item) => ({
      authLookupId: item.vaultId,
      participantId: item.giver.participantId,
      encryptedPayload: encryptJson(
        {
          participantId: item.giver.participantId,
          displayName: item.giver.displayName,
          recipientId: item.recipient.participantId,
          recipientName: item.recipient.displayName,
          recipientDepartment: item.recipient.department,
          cardMessage: item.cardMessage,
        },
        SECRET_KEY_HEX
      ),
      claimedByUid: null,
    }));

    const roster = assignments.map((item) => ({
      participantId: item.giver.participantId,
      displayName: item.giver.displayName,
      department: item.giver.department,
      vaultId: item.vaultId,
      encryptedPin: encryptJson({ pin: item.pin }, SECRET_KEY_HEX),
      hasParticipated: false,
      selectedBoxNumber: null,
      claimedByUid: null,
      participatedAt: null,
    }));

    res.json({ ok: true, meta, boxes, vaults, roster });
  } catch (err) {
    console.error('Prepare exchange error:', err);
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to prepare exchange.' });
  }
});

app.post('/api/admin/initialize', async (req, res) => {
  try {
    const user = await verifyFirebaseIdToken(req.headers.authorization);
    await assertAdmin(user);

    const { teachers: customTeachers } = (req.body || {}) as {
      teachers?: Array<{ displayName: string; department?: string }>;
    };

    let teacherList: TeacherSeed[] = DEFAULT_TEACHERS;
    if (Array.isArray(customTeachers) && customTeachers.length > 0) {
      if (customTeachers.length !== 20) {
        throw new HttpError(400, `Exactly 20 teachers are required (received ${customTeachers.length}).`);
      }
      teacherList = customTeachers.map((t, idx) => {
        const displayName = String(t.displayName || '').trim();
        const department = String(t.department || 'Faculty').trim() || 'Faculty';
        if (!displayName || displayName.length > 120) {
          throw new HttpError(400, `Invalid teacher name at row ${idx + 1}.`);
        }
        return {
          participantId: `teacher_${String(idx + 1).padStart(2, '0')}`,
          displayName,
          department: department.slice(0, 80),
        };
      });
    }

    // Generate server-side derangement
    const assignments = generateSecretSantaDerangement(teacherList, SECRET_KEY_HEX);

    // Clear existing exchange documents first so createdAt == REQUEST_TIME succeeds cleanly
    const [oldVaults, oldClaims, oldLocks, oldRoster, oldBoxes, oldMeta] = await Promise.all([
      firestoreList('credential_vault', user.idToken),
      firestoreList('claims', user.idToken),
      firestoreList('user_locks', user.idToken),
      firestoreList('roster_status', user.idToken),
      firestoreList('boxes', user.idToken),
      firestoreList('exchange_meta', user.idToken),
    ]);

    const deleteWrites: FirestoreCommitWrite[] = [
      ...oldVaults.map((d) => ({ delete: `${FIRESTORE_DOC_PATH_PREFIX}/credential_vault/${d._id}` })),
      ...oldClaims.map((d) => ({ delete: `${FIRESTORE_DOC_PATH_PREFIX}/claims/${d._id}` })),
      ...oldLocks.map((d) => ({ delete: `${FIRESTORE_DOC_PATH_PREFIX}/user_locks/${d._id}` })),
      ...oldRoster.map((d) => ({ delete: `${FIRESTORE_DOC_PATH_PREFIX}/roster_status/${d._id}` })),
      ...oldBoxes.map((d) => ({ delete: `${FIRESTORE_DOC_PATH_PREFIX}/boxes/${d._id}` })),
      ...oldMeta.map((d) => ({ delete: `${FIRESTORE_DOC_PATH_PREFIX}/exchange_meta/${d._id}` })),
    ];

    if (deleteWrites.length > 0) {
      await firestoreCommit(deleteWrites, user.idToken);
    }

    // Atomic batch creation of meta + 20 boxes + 20 roster_status + 20 credential_vault
    const createWrites: FirestoreCommitWrite[] = [];

    createWrites.push({
      update: {
        name: `${FIRESTORE_DOC_PATH_PREFIX}/exchange_meta/config`,
        fields: toFirestoreFields({
          title: 'The Christmas Gift Exchange',
          tagline: 'A Little Gift, A Lot of Love.',
          isOpen: true,
          isInitialized: true,
          participantCount: teacherList.length,
          adminEmail: ADMIN_EMAIL,
        }),
      },
      updateTransforms: [
        { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
        { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
      ],
      currentDocument: { exists: false },
    });

    for (let i = 1; i <= 20; i++) {
      const boxId = `box_${String(i).padStart(2, '0')}`;
      createWrites.push({
        update: {
          name: `${FIRESTORE_DOC_PATH_PREFIX}/boxes/${boxId}`,
          fields: toFirestoreFields({
            boxId,
            boxNumber: i,
            ribbonStyle: getRibbonStyle(i),
            status: 'unopened',
            openedByUid: null,
            openedAt: null,
          }),
        },
        updateTransforms: [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ],
        currentDocument: { exists: false },
      });
    }

    for (const item of assignments) {
      const encryptedPayload = encryptJson(
        {
          participantId: item.giver.participantId,
          displayName: item.giver.displayName,
          recipientId: item.recipient.participantId,
          recipientName: item.recipient.displayName,
          recipientDepartment: item.recipient.department,
          cardMessage: item.cardMessage,
        },
        SECRET_KEY_HEX
      );
      const encryptedPin = encryptJson({ pin: item.pin }, SECRET_KEY_HEX);

      createWrites.push({
        update: {
          name: `${FIRESTORE_DOC_PATH_PREFIX}/credential_vault/${item.vaultId}`,
          fields: toFirestoreFields({
            authLookupId: item.vaultId,
            participantId: item.giver.participantId,
            encryptedPayload,
            claimedByUid: null,
          }),
        },
        updateTransforms: [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ],
        currentDocument: { exists: false },
      });

      createWrites.push({
        update: {
          name: `${FIRESTORE_DOC_PATH_PREFIX}/roster_status/${item.giver.participantId}`,
          fields: toFirestoreFields({
            participantId: item.giver.participantId,
            displayName: item.giver.displayName,
            department: item.giver.department,
            vaultId: item.vaultId,
            encryptedPin,
            hasParticipated: false,
            selectedBoxNumber: null,
            claimedByUid: null,
            participatedAt: null,
          }),
        },
        updateTransforms: [
          { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
          { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
        ],
        currentDocument: { exists: false },
      });
    }

    // Commit in clean smaller batches to stay well within per-request rules limits
    const CHUNK_SIZE = 20;
    for (let i = 0; i < createWrites.length; i += CHUNK_SIZE) {
      await firestoreCommit(createWrites.slice(i, i + CHUNK_SIZE), user.idToken);
    }

    res.json({
      ok: true,
      participantCount: teacherList.length,
      message: 'All 20 Secret Santa assignments generated and sealed in Firestore.',
    });
  } catch (err) {
    console.error('Initialize error:', err);
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to initialize exchange.' });
  }
});

app.post('/api/admin/toggle-open', async (req, res) => {
  try {
    const user = await verifyFirebaseIdToken(req.headers.authorization);
    await assertAdmin(user);

    const { isOpen } = req.body as { isOpen?: boolean };
    if (typeof isOpen !== 'boolean') {
      throw new HttpError(400, 'Boolean isOpen value required.');
    }

    const meta = await firestoreGet<MetaDoc>('exchange_meta/config', user.idToken);
    if (!meta) {
      throw new HttpError(404, 'Exchange has not been initialized yet.');
    }

    await firestoreCommit(
      [
        {
          update: {
            name: `${FIRESTORE_DOC_PATH_PREFIX}/exchange_meta/config`,
            fields: toFirestoreFields({ isOpen }),
          },
          updateMask: { fieldPaths: ['isOpen'] },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          currentDocument: { exists: true },
        },
      ],
      user.idToken
    );

    res.json({ ok: true, isOpen });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to update participation status.' });
  }
});

app.post('/api/admin/regenerate-pin', async (req, res) => {
  try {
    const user = await verifyFirebaseIdToken(req.headers.authorization);
    await assertAdmin(user);

    const { participantId } = req.body as { participantId?: string };
    if (!participantId) {
      throw new HttpError(400, 'participantId is required.');
    }

    const rosterDoc = await firestoreGet<RosterDoc>(`roster_status/${participantId}`, user.idToken);
    if (!rosterDoc) {
      throw new HttpError(404, 'Participant not found.');
    }
    if (rosterDoc.hasParticipated) {
      throw new HttpError(409, 'Cannot regenerate PIN after a teacher has already completed their draw.');
    }

    const oldVault = await firestoreGet<VaultDoc>(`credential_vault/${rosterDoc.vaultId}`, user.idToken);
    if (!oldVault) {
      throw new HttpError(404, 'Credential vault entry not found.');
    }

    const newPin = generateAccessPin(6);
    const newVaultId = computeVaultId(rosterDoc.displayName, newPin, SECRET_KEY_HEX);
    const encryptedPin = encryptJson({ pin: newPin }, SECRET_KEY_HEX);

    await firestoreCommit(
      [
        {
          delete: `${FIRESTORE_DOC_PATH_PREFIX}/credential_vault/${rosterDoc.vaultId}`,
        },
        {
          update: {
            name: `${FIRESTORE_DOC_PATH_PREFIX}/credential_vault/${newVaultId}`,
            fields: toFirestoreFields({
              authLookupId: newVaultId,
              participantId: rosterDoc.participantId,
              encryptedPayload: oldVault.encryptedPayload,
              claimedByUid: null,
            }),
          },
          updateTransforms: [
            { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
            { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
          ],
          currentDocument: { exists: false },
        },
        {
          update: {
            name: `${FIRESTORE_DOC_PATH_PREFIX}/roster_status/${participantId}`,
            fields: toFirestoreFields({
              vaultId: newVaultId,
              encryptedPin,
            }),
          },
          updateMask: { fieldPaths: ['vaultId', 'encryptedPin'] },
          updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          currentDocument: { exists: true },
        },
      ],
      user.idToken
    );

    res.json({ ok: true, participantId, newPin });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to regenerate PIN.' });
  }
});

app.get('/api/admin/export-csv', async (req, res) => {
  try {
    const user = await verifyFirebaseIdToken(req.headers.authorization);
    await assertAdmin(user);

    const rosterDocs = await fetchAllRosterDocs(user.idToken);
    const sorted = rosterDocs.sort((a, b) => a.participantId.localeCompare(b.participantId));

    const header = 'Participant ID,Teacher Name,Status,Selected Box,Participated At';
    const rows = sorted.map((r) => {
      const safeName = `"${r.displayName.replace(/"/g, '""')}"`;
      const status = r.hasParticipated ? 'Completed' : 'Pending';
      const box = r.selectedBoxNumber ? `Box #${r.selectedBoxNumber}` : '-';
      const date = r.participatedAt || '-';
      return `${r.participantId},${safeName},${status},${box},${date}`;
    });

    const csv = [header, ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="christmas-gift-exchange-stats.csv"');
    res.send(csv);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Failed to export CSV.' });
  }
});

// Live server-side verification audit of the 20-teacher derangement engine & crypto vault
app.post('/api/admin/run-self-test', async (req, res) => {
  try {
    const user = await verifyFirebaseIdToken(req.headers.authorization);
    await assertAdmin(user);

    const iterations = 100;
    for (let i = 0; i < iterations; i++) {
      const testRun = generateSecretSantaDerangement(DEFAULT_TEACHERS, SECRET_KEY_HEX);
      verifyAssignmentsInvariant(DEFAULT_TEACHERS, testRun);
    }

    // Verify all active vault docs in Firestore can be decrypted & verified without leaking
    const rosterDocs = await fetchAllRosterDocs(user.idToken);
    let decryptedCount = 0;
    const givers = new Set<string>();
    const recipients = new Set<string>();
    let selfAssignments = 0;

    for (const r of rosterDocs) {
      const vault = await firestoreGet<VaultDoc>(`credential_vault/${r.vaultId}`, user.idToken);
      if (vault) {
        const payload = decryptJson<VaultPayload>(vault.encryptedPayload, SECRET_KEY_HEX);
        const pinObj = decryptJson<{ pin: string }>(r.encryptedPin, SECRET_KEY_HEX);
        const recomputedVault = computeVaultId(r.displayName, pinObj.pin, SECRET_KEY_HEX);
        if (recomputedVault !== r.vaultId) {
          throw new Error(`Vault HMAC mismatch for ${r.participantId}`);
        }
        if (payload.participantId === payload.recipientId) {
          selfAssignments++;
        }
        givers.add(payload.participantId);
        recipients.add(payload.recipientId);
        decryptedCount++;
      }
    }

    res.json({
      ok: true,
      derangementMonteCarloRuns: iterations,
      liveParticipantsVerified: decryptedCount,
      uniqueGivers: givers.size,
      uniqueRecipients: recipients.size,
      selfAssignments,
      bijectionValid: decryptedCount === 20 && givers.size === 20 && recipients.size === 20 && selfAssignments === 0,
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Self-test failed.' });
  }
});

// Prevent unused import lint error if normalizeTeacherName used only in engine
void normalizeTeacherName;

// --- Vite Dev Middleware / Production Static Server ---
async function startServer() {
  const port = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.resolve(process.cwd(), 'dist'));

  if (isProd) {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`The Christmas Gift Exchange server running on http://0.0.0.0:${port}`);
  });
}

if (!process.env.VERCEL) {
  startServer().catch((err) => {
    console.error('Fatal server startup error:', err);
    process.exit(1);
  });
}

export default app;
