import crypto from 'node:crypto';

export interface TeacherSeed {
  participantId: string;
  displayName: string;
  department: string;
}

export interface SecretSantaAssignment {
  giver: TeacherSeed;
  recipient: TeacherSeed;
  pin: string;
  vaultId: string;
  cardMessage: string;
}

export const DEFAULT_TEACHERS: TeacherSeed[] = [
  { participantId: 'teacher_01', displayName: 'OrevaOghene Brown', department: 'Faculty' },
  { participantId: 'teacher_02', displayName: 'Mrs. Esther Francis', department: 'Faculty' },
  { participantId: 'teacher_03', displayName: 'Miss Faith Jude', department: 'Faculty' },
  { participantId: 'teacher_04', displayName: 'Miracle Okudor', department: 'Faculty' },
  { participantId: 'teacher_05', displayName: 'Mrs. Eseoghene Oghwe', department: 'Faculty' },
  { participantId: 'teacher_06', displayName: 'Miss. Keno Okeoghene', department: 'Faculty' },
  { participantId: 'teacher_07', displayName: 'Miss. Tega Oghenegweke', department: 'Faculty' },
  { participantId: 'teacher_08', displayName: 'Mrs. Freda Obakor', department: 'Faculty' },
  { participantId: 'teacher_09', displayName: 'Mr. Usioboifo Perfection', department: 'Faculty' },
  { participantId: 'teacher_10', displayName: 'Miss. Mega Agbamu', department: 'Faculty' },
  { participantId: 'teacher_11', displayName: 'Mr. Idowu Alexander', department: 'Faculty' },
  { participantId: 'teacher_12', displayName: 'Miss. Katherine Auura', department: 'Faculty' },
  { participantId: 'teacher_13', displayName: 'Miss. Matthew Justina', department: 'Faculty' },
  { participantId: 'teacher_14', displayName: 'Miss. Mary Mark', department: 'Faculty' },
  { participantId: 'teacher_15', displayName: 'Mrs. Agatha Mele', department: 'Faculty' },
  { participantId: 'teacher_16', displayName: 'Mrs. Efe Blessing', department: 'Faculty' },
  { participantId: 'teacher_17', displayName: 'Mrs. Ify Onwusiakwe', department: 'Faculty' },
  { participantId: 'teacher_18', displayName: 'Mrs. Osas Muruako', department: 'Faculty' },
  { participantId: 'teacher_19', displayName: 'Miss. Hannah Ben', department: 'Faculty' },
  { participantId: 'teacher_20', displayName: 'Miss. Oluwole Blessing', department: 'Faculty' },
];

export const FESTIVE_MESSAGES: string[] = [
  'May your thoughtful gift bring warmth, laughter, and Christmas cheer to the staffroom this season.',
  'Wishing you joy in choosing something special for a colleague who inspires every day.',
  'A little gift wrapped with gratitude, kindness, and the happiest holiday wishes.',
  'Here is to shared smiles, warm cocoa, and a wonderful Christmas celebration together.',
  'May this small gesture carry a whole season of appreciation and festive warmth.',
];

const PIN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const HONORIFIC_REGEX = /^(mr|mrs|miss|ms|dr|prof|rev)\.?\s+/i;

export function normalizeTeacherName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function stripTeacherHonorific(name: string): string {
  return name.trim().replace(/\s+/g, ' ').replace(HONORIFIC_REGEX, '').trim();
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev;
      } else {
        dp[j] = 1 + Math.min(prev, dp[j], dp[j - 1]);
      }
      prev = temp;
    }
  }
  return dp[b.length];
}

function tokensLooselyMatch(inputToken: string, refToken: string): boolean {
  if (inputToken === refToken) return true;
  if (inputToken.length >= 3 && refToken.startsWith(inputToken)) return true;
  if (refToken.length >= 3 && inputToken.startsWith(refToken)) return true;
  return editDistance(inputToken, refToken) <= 2;
}

export function generateNameLookupCandidates(rawName: string): string[] {
  const cleaned = rawName.trim().replace(/[,]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  const add = (candidate: string) => {
    const norm = normalizeTeacherName(candidate);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(candidate.trim().replace(/\s+/g, ' '));
    }
  };

  add(cleaned);

  // Normalize honorific dot variations e.g. "Miss. Faith" <-> "Miss Faith"
  const dotMatch = cleaned.match(/^(mr|mrs|miss|ms|dr|prof|rev)(\.?)\s+(.+)$/i);
  if (dotMatch) {
    const title = dotMatch[1];
    const rest = dotMatch[3].trim();
    add(`${title} ${rest}`);
    add(`${title}. ${rest}`);
  }

  const core = stripTeacherHonorific(cleaned).replace(/\.+$/, '').trim();
  if (core) {
    add(core);
    for (const prefix of ['Miss', 'Miss.', 'Mrs', 'Mrs.', 'Mr', 'Mr.', 'Ms', 'Ms.', 'Dr', 'Dr.']) {
      add(`${prefix} ${core}`);
    }

    const words = core.split(' ').filter(Boolean);
    if (words.length === 2) {
      const swapped = `${words[1]} ${words[0]}`;
      add(swapped);
      for (const prefix of ['Miss', 'Miss.', 'Mrs', 'Mrs.', 'Mr', 'Mr.']) {
        add(`${prefix} ${swapped}`);
      }
    }

    // Match against known default roster names for minor spelling or missing-honorific variations
    if (words.length >= 2) {
      const inputTokens = words.map((w) => w.toLowerCase());
      for (const teacher of DEFAULT_TEACHERS) {
        const refTokens = stripTeacherHonorific(teacher.displayName)
          .toLowerCase()
          .split(' ')
          .filter(Boolean);
        const allMatch = inputTokens.every((inTok) =>
          refTokens.some((refTok) => tokensLooselyMatch(inTok, refTok))
        );
        if (allMatch) {
          add(teacher.displayName);
        }
      }
    }
  }

  return out.slice(0, 30);
}

export function generateAccessPin(length = 6): string {
  let pin = '';
  for (let i = 0; i < length; i++) {
    pin += PIN_ALPHABET[crypto.randomInt(0, PIN_ALPHABET.length)];
  }
  return pin;
}

export function computeVaultId(displayName: string, pin: string, secretKeyHex: string): string {
  const normalizedPin = pin.replace(/\s+/g, '').toUpperCase();
  const normalized = `${normalizeTeacherName(displayName)}:${normalizedPin}`;
  return crypto
    .createHmac('sha256', Buffer.from(secretKeyHex, 'hex'))
    .update(normalized)
    .digest('hex');
}

export function encryptJson(payload: unknown, secretKeyHex: string): string {
  const key = Buffer.from(secretKeyHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}.${tag.toString('hex')}.${encrypted.toString('hex')}`;
}

export function decryptJson<T>(token: string, secretKeyHex: string): T {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format.');
  }
  const [ivHex, tagHex, dataHex] = parts;
  const key = Buffer.from(secretKeyHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8')) as T;
}

/**
 * Generates a cryptographically random 1-to-1 derangement over all participants.
 * Guarantees:
 * 1. Nobody receives themselves (giver.participantId !== recipient.participantId).
 * 2. Every participant has exactly one recipient.
 * 3. Every participant is assigned as a recipient exactly once.
 */
export function generateSecretSantaDerangement(
  teachers: TeacherSeed[],
  secretKeyHex: string
): SecretSantaAssignment[] {
  if (teachers.length < 2) {
    throw new Error('At least 2 participants are required for Secret Santa.');
  }

  const normalizedSet = new Set<string>();
  for (const t of teachers) {
    const norm = normalizeTeacherName(t.displayName);
    if (!norm) {
      throw new Error(`Empty teacher name for ${t.participantId}`);
    }
    if (normalizedSet.has(norm)) {
      throw new Error(`Duplicate teacher name detected: ${t.displayName}`);
    }
    normalizedSet.add(norm);
  }

  const n = teachers.length;
  const indices = Array.from({ length: n }, (_, i) => i);

  // Uniform random derangement via Fisher-Yates + rejection sampling (~2.72 expected tries)
  let valid = false;
  let attempts = 0;
  while (!valid) {
    attempts++;
    if (attempts > 500) {
      throw new Error('Failed to generate derangement within safety bound.');
    }
    for (let i = n - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      const tmp = indices[i];
      indices[i] = indices[j];
      indices[j] = tmp;
    }
    valid = true;
    for (let i = 0; i < n; i++) {
      if (indices[i] === i) {
        valid = false;
        break;
      }
    }
  }

  // Generate unique PINs across all 20 teachers
  const usedPins = new Set<string>();
  const assignments: SecretSantaAssignment[] = teachers.map((giver, idx) => {
    const recipient = teachers[indices[idx]];
    let pin = generateAccessPin(6);
    while (usedPins.has(pin)) {
      pin = generateAccessPin(6);
    }
    usedPins.add(pin);

    return {
      giver,
      recipient,
      pin,
      vaultId: computeVaultId(giver.displayName, pin, secretKeyHex),
      cardMessage: FESTIVE_MESSAGES[idx % FESTIVE_MESSAGES.length],
    };
  });

  verifyAssignmentsInvariant(teachers, assignments);
  return assignments;
}

export function verifyAssignmentsInvariant(
  teachers: TeacherSeed[],
  assignments: SecretSantaAssignment[]
): void {
  if (assignments.length !== teachers.length) {
    throw new Error('Assignment count mismatch.');
  }
  const givers = new Set<string>();
  const recipients = new Set<string>();
  for (const item of assignments) {
    if (item.giver.participantId === item.recipient.participantId) {
      throw new Error(`Self-assignment detected for ${item.giver.displayName}`);
    }
    if (givers.has(item.giver.participantId)) {
      throw new Error(`Duplicate giver detected: ${item.giver.displayName}`);
    }
    if (recipients.has(item.recipient.participantId)) {
      throw new Error(`Duplicate recipient detected: ${item.recipient.displayName}`);
    }
    givers.add(item.giver.participantId);
    recipients.add(item.recipient.participantId);
  }
  if (givers.size !== teachers.length || recipients.size !== teachers.length) {
    throw new Error('Bijection invariant failed.');
  }
}
