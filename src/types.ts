export interface ExchangeMeta {
  title: string;
  tagline: string;
  isOpen: boolean;
  isInitialized: boolean;
  participantCount: number;
}

export interface MysteryBoxItem {
  boxId: string;
  boxNumber: number;
  ribbonStyle: 'burgundy' | 'gold' | 'forest' | 'ivory';
  status: 'unopened' | 'opened';
  isMine: boolean;
}

export interface TeacherClaim {
  participantId: string;
  ownerUid: string;
  ownerEmail: string;
  vaultId?: string;
  displayName: string;
  recipientName: string;
  recipientDepartment: string;
  boxNumber: number;
  cardMessage: string;
  createdAt: string;
}

export interface ExchangeStateResponse {
  meta: ExchangeMeta | null;
  boxes: MysteryBoxItem[];
  existingClaim: TeacherClaim | null;
  isAdmin: boolean;
}

export interface AdminParticipantRow {
  participantId: string;
  displayName: string;
  department: string;
  pin: string;
  hasParticipated: boolean;
  selectedBoxNumber: number | null;
  participatedAt: string | null;
}

export interface AdminDashboardResponse {
  meta: ExchangeMeta | null;
  participants: AdminParticipantRow[];
  stats: {
    total: number;
    completed: number;
    pending: number;
    boxesOpened: number;
  };
  defaultTeachers: Array<{
    participantId: string;
    displayName: string;
    department: string;
  }>;
}
