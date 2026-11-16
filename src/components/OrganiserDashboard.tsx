import { useCallback, useEffect, useState } from 'react';
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import {
  ArrowUp,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Gift,
  LayoutDashboard,
  Lock,
  RefreshCw,
  ShieldCheck,
  Unlock,
  Users,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type { AdminDashboardResponse } from '../types';

interface OrganiserDashboardProps {
  getIdToken: () => Promise<string>;
  onExchangeUpdated: () => Promise<void>;
}

type FilterTab = 'all' | 'completed' | 'pending';

async function parseJsonResponse(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text || `Server responded with HTTP ${res.status}`);
  }
}

async function copyTextSafely(text: string) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to execCommand when iframe blocks async clipboard API
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand('copy');
  textarea.remove();
  if (!ok) {
    throw new Error('Could not copy to clipboard.');
  }
}

export function OrganiserDashboard({
  getIdToken,
  onExchangeUpdated,
}: OrganiserDashboardProps) {
  const [data, setData] = useState<AdminDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [activeNav, setActiveNav] = useState<'monitor' | 'roster' | 'audit'>('monitor');
  const [editableTeachers, setEditableTeachers] = useState<
    Array<{ displayName: string; department: string }>
  >([]);
  const [auditReport, setAuditReport] = useState<{
    derangementMonteCarloRuns: number;
    liveParticipantsVerified: number;
    uniqueGivers: number;
    uniqueRecipients: number;
    selfAssignments: number;
    bijectionValid: boolean;
  } | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/admin/dashboard', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await parseJsonResponse(res);
      if (!res.ok) {
        throw new Error(json.error || 'Failed to load organiser dashboard.');
      }
      const typed = json as AdminDashboardResponse;
      setData(typed);
      if (typed.participants.length === 20) {
        setEditableTeachers(
          typed.participants.map((p) => ({
            displayName: p.displayName,
            department: p.department,
          }))
        );
      } else if (typed.defaultTeachers.length === 20) {
        setEditableTeachers(
          typed.defaultTeachers.map((t) => ({
            displayName: t.displayName,
            department: t.department,
          }))
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to fetch dashboard.');
    } finally {
      setLoading(false);
    }
  }, [getIdToken]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const handleInitialize = async (useEditedRoster: boolean) => {
    setBusyAction('initialize');
    setError(null);
    setNotice(null);
    setShowResetConfirm(false);
    try {
      const token = await getIdToken();
      const body =
        useEditedRoster && editableTeachers.length === 20
          ? { teachers: editableTeachers }
          : {};
      const res = await fetch('/api/admin/prepare-exchange', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const json = await parseJsonResponse(res);
      if (!res.ok) {
        throw new Error(json.error || 'Failed to generate Secret Santa pairings.');
      }

      // 1. Delete existing exchange documents so createdAt == request.time succeeds cleanly
      const collectionsToClear = [
        'credential_vault',
        'claims',
        'user_locks',
        'roster_status',
        'boxes',
        'exchange_meta',
      ] as const;

      const deleteRefs: Array<ReturnType<typeof doc>> = [];
      for (const colName of collectionsToClear) {
        try {
          const snap = await getDocs(collection(db, colName));
          snap.forEach((d) => deleteRefs.push(d.ref));
        } catch (fsErr) {
          handleFirestoreError(fsErr, OperationType.LIST, colName);
        }
      }

      if (deleteRefs.length > 0) {
        try {
          for (let i = 0; i < deleteRefs.length; i += 400) {
            const delBatch = writeBatch(db);
            for (const ref of deleteRefs.slice(i, i + 400)) {
              delBatch.delete(ref);
            }
            await delBatch.commit();
          }
        } catch (fsErr) {
          handleFirestoreError(fsErr, OperationType.DELETE, 'exchange_reset');
        }
      }

      // 2. Write boxes, credential_vault, roster_status, and exchange_meta in safe batches via official Firebase SDK
      try {
        const ts = serverTimestamp();
        const pendingWrites: Array<{ path: [string, string]; payload: Record<string, unknown> }> = [
          ...json.boxes.map((box: Record<string, unknown>) => ({
            path: ['boxes', String(box.boxId)] as [string, string],
            payload: { ...box, createdAt: ts, updatedAt: ts },
          })),
          ...json.vaults.map((vault: Record<string, unknown>) => ({
            path: ['credential_vault', String(vault.authLookupId)] as [string, string],
            payload: { ...vault, createdAt: ts, updatedAt: ts },
          })),
          ...json.roster.map((r: Record<string, unknown>) => ({
            path: ['roster_status', String(r.participantId)] as [string, string],
            payload: { ...r, createdAt: ts, updatedAt: ts },
          })),
          {
            path: ['exchange_meta', 'config'],
            payload: { ...json.meta, createdAt: ts, updatedAt: ts },
          },
        ];

        for (let i = 0; i < pendingWrites.length; i += 20) {
          const chunkBatch = writeBatch(db);
          for (const item of pendingWrites.slice(i, i + 20)) {
            chunkBatch.set(doc(db, item.path[0], item.path[1]), item.payload);
          }
          await chunkBatch.commit();
        }
      } catch (fsErr) {
        handleFirestoreError(fsErr, OperationType.WRITE, 'exchange_initialize');
      }

      setNotice('All 20 Secret Santa assignments and access PINs generated and sealed in Firestore.');
      setActiveNav('monitor');
      await loadDashboard();
      await onExchangeUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Initialization failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleToggleOpen = async () => {
    if (!data?.meta) return;
    setBusyAction('toggle');
    setError(null);
    setNotice(null);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/admin/toggle-open', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isOpen: !data.meta.isOpen }),
      });
      const json = await parseJsonResponse(res);
      if (!res.ok) {
        throw new Error(json.error || 'Failed to update exchange status.');
      }
      setNotice(json.isOpen ? 'Participation is now open.' : 'Participation has been closed.');
      await loadDashboard();
      await onExchangeUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status update failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRegeneratePin = async (participantId: string, name: string) => {
    setBusyAction(`pin_${participantId}`);
    setError(null);
    setNotice(null);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/admin/regenerate-pin', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ participantId }),
      });
      const json = await parseJsonResponse(res);
      if (!res.ok) {
        throw new Error(json.error || 'Failed to regenerate PIN.');
      }
      setNotice(`Generated new access PIN ${json.newPin} for ${name}.`);
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PIN regeneration failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportCsv = async () => {
    setBusyAction('export');
    setError(null);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/admin/export-csv', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Export failed.');
      }
      const csvText = await res.text();
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'christmas-gift-exchange-stats.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setNotice('Participation statistics exported to CSV.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSV export failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRunAudit = async () => {
    setBusyAction('audit');
    setError(null);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/admin/run-self-test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await parseJsonResponse(res);
      if (!res.ok) {
        throw new Error(json.error || 'Audit failed.');
      }
      setAuditReport(json);
      setNotice('Assignment engine & encrypted vault audit completed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audit failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const copyInvite = async (participantId: string, displayName: string, pin: string) => {
    const shareUrl = window.location.origin;
    const msg = `Merry Christmas ${displayName}! You are invited to The Christmas Gift Exchange ("A Little Gift, A Lot of Love.").\nLink: ${shareUrl}\nRegistered Name: ${displayName}\nAccess PIN: ${pin}`;
    try {
      await copyTextSafely(msg);
      setCopiedId(participantId);
      setTimeout(() => setCopiedId(null), 2200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not copy invite.');
    }
  };

  const copyAllPins = async () => {
    if (participants.length === 0) return;
    const shareUrl = window.location.origin;
    const lines = participants.map(
      (p, idx) =>
        `${String(idx + 1).padStart(2, '0')}. ${p.displayName} — PIN: ${p.pin} [${p.hasParticipated ? `Completed Box #${p.selectedBoxNumber}` : 'Pending'}]`
    );
    try {
      await copyTextSafely(
        `The Christmas Gift Exchange — Teacher Access PINs\nPortal Link: ${shareUrl}\n\n${lines.join('\n')}`
      );
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not copy all PINs.');
    }
  };

  if (loading && !data) {
    return (
      <section id="organiser" className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-[#D4AF37]/25 bg-[#0F2A21] p-8 text-center text-sm text-[#D8CEBE]">
          Loading Organiser Dashboard...
        </div>
      </section>
    );
  }

  const participants = data?.participants || [];
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filtered = participants.filter((p) => {
    if (filter === 'completed' && !p.hasParticipated) return false;
    if (filter === 'pending' && p.hasParticipated) return false;
    if (
      normalizedQuery &&
      !p.displayName.toLowerCase().includes(normalizedQuery) &&
      !p.pin.toLowerCase().includes(normalizedQuery)
    ) {
      return false;
    }
    return true;
  });

  const isInitialized = Boolean(data?.meta?.isInitialized);

  return (
    <section id="organiser" className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="rounded-3xl border border-[#D4AF37]/30 bg-[#0D251D] p-6 shadow-xl sm:p-8">
        {/* Header */}
        <div className="flex flex-col gap-4 border-b border-[#D4AF37]/20 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium text-[#E8CC75]">
              Organiser Control Center
            </p>
            <h2 className="mt-1 font-display text-2xl font-bold text-[#FAF6EE] sm:text-3xl">
              Faculty Gift Exchange Monitor
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {!isInitialized ? (
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => handleInitialize(false)}
                className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl bg-[#7A1C2E] px-5 py-2.5 text-sm font-semibold text-[#FAF6EE] transition-colors hover:bg-[#631423] disabled:opacity-50 whitespace-nowrap"
              >
                <RefreshCw className={`h-4 w-4 ${busyAction === 'initialize' ? 'animate-spin' : ''}`} />
                <span>Initialize 20-Teacher Exchange</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={handleToggleOpen}
                  className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-[#D4AF37]/40 bg-[#13362B] px-4 py-2 text-sm font-medium text-[#FAF6EE] transition-colors hover:bg-[#194638] disabled:opacity-50 whitespace-nowrap"
                >
                  {data?.meta?.isOpen ? (
                    <>
                      <Lock className="h-4 w-4 text-[#E8CC75]" />
                      <span>Close Participation</span>
                    </>
                  ) : (
                    <>
                      <Unlock className="h-4 w-4 text-[#E8CC75]" />
                      <span>Reopen Participation</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={handleExportCsv}
                  className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-[#D4AF37]/40 bg-[#13362B] px-4 py-2 text-sm font-medium text-[#FAF6EE] transition-colors hover:bg-[#194638] disabled:opacity-50 whitespace-nowrap"
                >
                  <Download className="h-4 w-4 text-[#E8CC75]" />
                  <span>Export Stats CSV</span>
                </button>

                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => setShowResetConfirm((v) => !v)}
                  className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-[#7A1C2E]/70 bg-[#5C1624]/40 px-4 py-2 text-sm font-medium text-[#FAF6EE] transition-colors hover:bg-[#7A1C2E]/70 disabled:opacity-50 whitespace-nowrap"
                >
                  <RefreshCw className="h-4 w-4" />
                  <span>Reset &amp; Reassign</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Organiser Control Center Navigation Bar */}
        <nav
          aria-label="Organiser control center navigation"
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#D4AF37]/20 bg-[#091B15] px-3 py-2.5"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setActiveNav('monitor');
                void loadDashboard();
              }}
              className={`inline-flex min-h-[38px] cursor-pointer items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                activeNav === 'monitor'
                  ? 'bg-[#7A1C2E] text-[#FAF6EE]'
                  : 'text-[#D8CEBE] hover:bg-[#123026] hover:text-[#FAF6EE]'
              }`}
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              <span>Monitor &amp; PINs</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveNav('roster')}
              className={`inline-flex min-h-[38px] cursor-pointer items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                activeNav === 'roster'
                  ? 'bg-[#7A1C2E] text-[#FAF6EE]'
                  : 'text-[#D8CEBE] hover:bg-[#123026] hover:text-[#FAF6EE]'
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              <span>Edit 20 Teachers</span>
            </button>

            {isInitialized && (
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => {
                  setActiveNav('audit');
                  void handleRunAudit();
                }}
                className={`inline-flex min-h-[38px] cursor-pointer items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 whitespace-nowrap ${
                  activeNav === 'audit'
                    ? 'bg-[#7A1C2E] text-[#FAF6EE]'
                    : 'text-[#D8CEBE] hover:bg-[#123026] hover:text-[#FAF6EE]'
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>Verify Assignments</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs font-medium">
            {isInitialized && (
              <a
                href="#gift-boxes"
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-[#E8CC75] transition-colors hover:bg-[#123026] hover:text-[#FAF6EE] whitespace-nowrap"
              >
                <Gift className="h-3.5 w-3.5" />
                <span>Gift Boxes</span>
              </a>
            )}
            <a
              href="#top"
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-[#D8CEBE] transition-colors hover:bg-[#123026] hover:text-[#FAF6EE] whitespace-nowrap"
            >
              <ArrowUp className="h-3.5 w-3.5" />
              <span>Back to Top</span>
            </a>
          </div>
        </nav>

        {/* Feedback Banners */}
        {error && (
          <div className="mt-5 flex flex-col gap-3 rounded-xl border border-[#B42A43]/60 bg-[#4A0D19]/70 px-4 py-3 text-sm text-[#FAF6EE] sm:flex-row sm:items-center sm:justify-between">
            <span className="break-words">{error}</span>
            <button
              type="button"
              onClick={() => void loadDashboard()}
              className="inline-flex min-h-[36px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-[#FAF6EE]/25 px-3 py-1 text-xs font-semibold text-[#FAF6EE] hover:bg-black/20 whitespace-nowrap"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}
        {notice && (
          <div className="mt-5 rounded-xl border border-[#D4AF37]/45 bg-[#153C2F] px-4 py-3 text-sm text-[#FAF6EE]">
            {notice}
          </div>
        )}

        {/* Inline Reset Confirmation */}
        {showResetConfirm && (
          <div className="mt-5 flex flex-col gap-3 rounded-xl border border-[#D4AF37]/40 bg-[#4A0D19]/50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[#FAF6EE]">
              Resetting will clear all existing draws and generate fresh Secret Santa assignments and new PINs for all 20 teachers.
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="min-h-[40px] cursor-pointer rounded-lg border border-[#FAF6EE]/25 px-3 py-1.5 text-xs font-medium text-[#FAF6EE] hover:bg-black/20"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleInitialize(false)}
                className="min-h-[40px] cursor-pointer rounded-lg bg-[#7A1C2E] px-4 py-1.5 text-xs font-semibold text-[#FAF6EE] hover:bg-[#631423]"
              >
                Confirm Reset
              </button>
            </div>
          </div>
        )}

        {/* Audit Result Banner */}
        {activeNav === 'audit' && (
          <div className="mt-5 rounded-xl border border-[#D4AF37]/30 bg-[#102F24] p-4">
            {auditReport ? (
              <div className="grid gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-[#D8CEBE]">Live Vaults Verified</p>
                  <p className="mt-1 font-mono-tabular text-lg font-semibold text-[#FAF6EE]">
                    {auditReport.liveParticipantsVerified} / 20
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#D8CEBE]">Self-Assignments</p>
                  <p className="mt-1 font-mono-tabular text-lg font-semibold text-[#F3D878]">
                    {auditReport.selfAssignments}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#D8CEBE]">Bijection Integrity</p>
                  <p className="mt-1 text-lg font-semibold text-[#FAF6EE]">
                    {auditReport.bijectionValid ? '1-to-1 Verified' : 'Check Needed'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#D8CEBE]">Engine Stress Runs</p>
                  <p className="mt-1 font-mono-tabular text-lg font-semibold text-[#FAF6EE]">
                    {auditReport.derangementMonteCarloRuns} passed
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[#D8CEBE]">Running assignment integrity audit...</p>
            )}
          </div>
        )}

        {/* Editable 20-Teacher Roster Panel */}
        {activeNav === 'roster' && (
          <div className="mt-6 rounded-2xl border border-[#D4AF37]/25 bg-[#091B15] p-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-display text-lg font-semibold text-[#FAF6EE]">
                  Customize 20-Teacher Roster
                </h3>
                <p className="text-xs text-[#D8CEBE]">
                  Review or update participant names below, then save &amp; generate assignments.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {data?.defaultTeachers && data.defaultTeachers.length === 20 && (
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() =>
                      setEditableTeachers(
                        data.defaultTeachers.map((t) => ({
                          displayName: t.displayName,
                          department: 'Faculty',
                        }))
                      )
                    }
                    className="min-h-[40px] cursor-pointer rounded-xl border border-[#D4AF37]/30 px-3.5 py-2 text-xs font-medium text-[#E8CC75] hover:bg-[#13362B] disabled:opacity-50 whitespace-nowrap"
                  >
                    Load 20 Supplied Names
                  </button>
                )}
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => handleInitialize(true)}
                  className="min-h-[40px] cursor-pointer rounded-xl bg-[#7A1C2E] px-4 py-2 text-xs font-semibold text-[#FAF6EE] hover:bg-[#631423] disabled:opacity-50 whitespace-nowrap"
                >
                  Save Roster &amp; Generate Assignments
                </button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {editableTeachers.map((teacher, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="w-7 font-mono-tabular text-xs text-[#E8CC75]">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <input
                    type="text"
                    value={teacher.displayName}
                    onChange={(e) => {
                      const next = [...editableTeachers];
                      next[idx] = { ...next[idx], displayName: e.target.value };
                      setEditableTeachers(next);
                    }}
                    placeholder="Participant full name"
                    className="min-h-[40px] flex-1 rounded-lg border border-[#D4AF37]/25 bg-[#0E261E] px-3 py-1.5 text-sm text-[#FAF6EE] focus:border-[#F3D878] focus:outline-none"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 4-Column KPI Strip */}
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-2xl border border-[#D4AF37]/20 bg-[#102E24] p-4">
            <p className="text-xs text-[#D8CEBE]">Total Participants</p>
            <p className="mt-1 font-mono-tabular text-2xl font-semibold text-[#FAF6EE]">
              {data?.stats.total ?? 0}
            </p>
          </div>
          <div className="rounded-2xl border border-[#D4AF37]/20 bg-[#102E24] p-4">
            <p className="text-xs text-[#D8CEBE]">Completed Draws</p>
            <p className="mt-1 font-mono-tabular text-2xl font-semibold text-[#F3D878]">
              {data?.stats.completed ?? 0}
            </p>
          </div>
          <div className="rounded-2xl border border-[#D4AF37]/20 bg-[#102E24] p-4">
            <p className="text-xs text-[#D8CEBE]">Yet to Participate</p>
            <p className="mt-1 font-mono-tabular text-2xl font-semibold text-[#FAF6EE]">
              {data?.stats.pending ?? 0}
            </p>
          </div>
          <div className="rounded-2xl border border-[#D4AF37]/20 bg-[#102E24] p-4">
            <p className="text-xs text-[#D8CEBE]">Exchange Status</p>
            <p className="mt-1 text-2xl font-semibold text-[#FAF6EE]">
              {!isInitialized ? 'Not Set' : data?.meta?.isOpen ? 'Open' : 'Closed'}
            </p>
          </div>
        </div>

        {/* Monitor & PINs: Pre-initialization guidance when not yet initialized */}
        {!isInitialized && participants.length === 0 && activeNav === 'monitor' && (
          <div className="mt-8 rounded-2xl border border-[#D4AF37]/25 bg-[#091B15] p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-display text-xl font-semibold text-[#FAF6EE]">
                  Access PINs &amp; Participation Monitor
                </h3>
                <p className="mt-1 text-sm text-[#D8CEBE]">
                  No access PINs have been generated yet. Initialize the 20-teacher exchange to create encrypted Secret Santa pairings and unique 6-character PINs for every teacher below.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveNav('roster')}
                  className="inline-flex min-h-[42px] cursor-pointer items-center gap-2 rounded-xl border border-[#D4AF37]/35 px-4 py-2 text-xs font-semibold text-[#E8CC75] hover:bg-[#13362B] whitespace-nowrap"
                >
                  <Users className="h-4 w-4" />
                  <span>Edit 20 Teachers First</span>
                </button>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() => handleInitialize(false)}
                  className="inline-flex min-h-[42px] cursor-pointer items-center gap-2 rounded-xl bg-[#7A1C2E] px-5 py-2 text-xs font-semibold text-[#FAF6EE] hover:bg-[#631423] disabled:opacity-50 whitespace-nowrap"
                >
                  <RefreshCw className={`h-4 w-4 ${busyAction === 'initialize' ? 'animate-spin' : ''}`} />
                  <span>Generate Pairings &amp; 20 PINs</span>
                </button>
              </div>
            </div>

            {editableTeachers.length > 0 && (
              <div className="mt-6 overflow-x-auto rounded-xl border border-[#D4AF37]/15 bg-[#0D251D]">
                <table className="w-full min-w-[480px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#D4AF37]/15 text-xs text-[#E8CC75]">
                      <th className="px-4 py-3 font-medium">#</th>
                      <th className="px-4 py-3 font-medium">Participant Name</th>
                      <th className="px-4 py-3 font-medium">Access PIN</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#D4AF37]/10">
                    {editableTeachers.map((t, idx) => (
                      <tr key={idx}>
                        <td className="px-4 py-2.5 font-mono-tabular text-xs text-[#E8CC75]">
                          {String(idx + 1).padStart(2, '0')}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-[#FAF6EE]">
                          {t.displayName}
                        </td>
                        <td className="px-4 py-2.5 font-mono-tabular text-xs text-[#D8CEBE]/70">
                          Not generated yet
                        </td>
                        <td className="px-4 py-2.5 text-xs text-[#D8CEBE]/75">
                          Ready to initialize
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Filter Segmented Control + Roster Table */}
        {(isInitialized || participants.length > 0) && activeNav !== 'roster' && (
          <div className="mt-8">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex items-center gap-1 rounded-xl border border-[#D4AF37]/20 bg-[#091B15] p-1">
                  {(
                    [
                      { id: 'all', label: `All (${participants.length})` },
                      {
                        id: 'completed',
                        label: `Completed (${data?.stats.completed ?? 0})`,
                      },
                      {
                        id: 'pending',
                        label: `Pending (${data?.stats.pending ?? 0})`,
                      },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setFilter(tab.id)}
                      className={`min-h-[38px] cursor-pointer rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                        filter === tab.id
                          ? 'bg-[#7A1C2E] text-[#FAF6EE]'
                          : 'text-[#D8CEBE] hover:text-[#FAF6EE]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search teacher or PIN..."
                  aria-label="Search teacher or PIN"
                  className="min-h-[40px] w-full rounded-xl border border-[#D4AF37]/25 bg-[#091B15] px-3.5 py-1.5 text-xs text-[#FAF6EE] placeholder:text-[#D8CEBE]/50 focus:border-[#F3D878] focus:outline-none sm:w-52"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadDashboard()}
                  disabled={loading}
                  className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-xl border border-[#D4AF37]/30 bg-[#091B15] px-3.5 py-1.5 text-xs font-medium text-[#D8CEBE] hover:bg-[#13362B] hover:text-[#FAF6EE] disabled:opacity-50 whitespace-nowrap"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  <span>Refresh Status</span>
                </button>
                <button
                  type="button"
                  onClick={copyAllPins}
                  className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-xl border border-[#D4AF37]/35 bg-[#13362B] px-3.5 py-1.5 text-xs font-semibold text-[#FAF6EE] hover:bg-[#194638] whitespace-nowrap"
                >
                  {copiedAll ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-[#F3D878]" />
                      <span>All 20 PINs Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5 text-[#E8CC75]" />
                      <span>Copy All 20 PINs</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-[#D4AF37]/20 bg-[#091B15]">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[#D4AF37]/20 text-xs text-[#E8CC75]">
                    <th className="px-4 py-3.5 font-medium">Name</th>
                    <th className="px-4 py-3.5 font-medium">Access PIN</th>
                    <th className="px-4 py-3.5 font-medium">Status</th>
                    <th className="px-4 py-3.5 font-medium">Box</th>
                    <th className="px-4 py-3.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#D4AF37]/10">
                  {filtered.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-8 text-center text-sm text-[#D8CEBE]"
                      >
                        No participants match the selected filter or search query.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((row) => (
                      <tr key={row.participantId} className="hover:bg-[#102A21]/60">
                        <td className="px-4 py-3 font-medium text-[#FAF6EE]">
                          {row.displayName}
                        </td>
                        <td className="px-4 py-3 font-mono-tabular font-semibold tracking-wider text-[#F3D878]">
                          {row.pin}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                            {row.hasParticipated ? (
                              <>
                                <CheckCircle2 className="h-3.5 w-3.5 text-[#E8CC75]" />
                                <span className="text-[#FAF6EE]">Completed</span>
                              </>
                            ) : (
                              <>
                                <Clock className="h-3.5 w-3.5 text-[#D8CEBE]/75" />
                                <span className="text-[#D8CEBE]">Pending</span>
                              </>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono-tabular text-[#FAF6EE]">
                          {row.selectedBoxNumber
                            ? `#${String(row.selectedBoxNumber).padStart(2, '0')}`
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                copyInvite(row.participantId, row.displayName, row.pin)
                              }
                              className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg border border-[#D4AF37]/30 px-3 py-1 text-xs font-medium text-[#FAF6EE] hover:bg-[#14362B] whitespace-nowrap"
                            >
                              {copiedId === row.participantId ? (
                                <>
                                  <Check className="h-3.5 w-3.5 text-[#F3D878]" />
                                  <span>Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3.5 w-3.5 text-[#E8CC75]" />
                                  <span>Copy Invite</span>
                                </>
                              )}
                            </button>
                            {!row.hasParticipated && (
                              <button
                                type="button"
                                disabled={busyAction !== null}
                                onClick={() =>
                                  handleRegeneratePin(row.participantId, row.displayName)
                                }
                                className="inline-flex min-h-[36px] cursor-pointer items-center gap-1 rounded-lg border border-[#FAF6EE]/15 px-2.5 py-1 text-xs text-[#D8CEBE] hover:bg-[#14362B] hover:text-[#FAF6EE] disabled:opacity-50 whitespace-nowrap"
                              >
                                <RefreshCw className="h-3 w-3" />
                                <span>New PIN</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
