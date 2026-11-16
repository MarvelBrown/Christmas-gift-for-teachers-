import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  AlertCircle,
  CheckCircle2,
  Gift,
  KeyRound,
  LogIn,
  LogOut,
  Shield,
} from 'lucide-react';
import { ChristmasLights } from './components/ChristmasLights';
import { GiftBoxGrid } from './components/GiftBoxGrid';
import { GreetingCard } from './components/GreetingCard';
import { OrganiserDashboard } from './components/OrganiserDashboard';
import { Snowfall } from './components/Snowfall';
import { auth, signInWithGoogle, signOutUser } from './firebase';
import type { ExchangeStateResponse, TeacherClaim } from './types';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [exchangeState, setExchangeState] = useState<ExchangeStateResponse | null>(null);
  const [loadingState, setLoadingState] = useState(false);

  // Teacher PIN verification state
  const [teacherName, setTeacherName] = useState('');
  const [accessPin, setAccessPin] = useState('');
  const [verifiedTeacher, setVerifiedTeacher] = useState<{
    participantId: string;
    displayName: string;
  } | null>(null);
  const [verifyingPin, setVerifyingPin] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Box opening animation & revealed card state
  const [openingBoxNumber, setOpeningBoxNumber] = useState<number | null>(null);
  const [boxError, setBoxError] = useState<string | null>(null);
  const [activeClaim, setActiveClaim] = useState<TeacherClaim | null>(null);
  const [heroImgFailed, setHeroImgFailed] = useState(false);

  const getIdToken = useCallback(async () => {
    if (!auth.currentUser) {
      throw new Error('Please sign in with Google first.');
    }
    return auth.currentUser.getIdToken();
  }, []);

  const loadExchangeState = useCallback(async (currentUser: User | null) => {
    if (!currentUser) {
      setExchangeState(null);
      setActiveClaim(null);
      setVerifiedTeacher(null);
      return;
    }
    setLoadingState(true);
    try {
      const token = await currentUser.getIdToken();
      const res = await fetch('/api/exchange/state', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Could not load exchange state.');
      }
      const typed = json as ExchangeStateResponse;
      setExchangeState(typed);
      if (typed.existingClaim) {
        setActiveClaim(typed.existingClaim);
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to connect to exchange.');
    } finally {
      setLoadingState(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
      void loadExchangeState(u);
    });
    return () => unsubscribe();
  }, [loadExchangeState]);

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Google Sign-In was cancelled or failed.'
      );
    }
  };

  const handleSignOut = async () => {
    await signOutUser();
    setTeacherName('');
    setAccessPin('');
    setVerifiedTeacher(null);
    setActiveClaim(null);
    setAuthError(null);
    setBoxError(null);
  };

  const handleVerifyPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setBoxError(null);

    if (!user) {
      setAuthError('Please sign in with your Google account first to verify your identity.');
      return;
    }
    if (!teacherName.trim() || !accessPin.trim()) {
      setAuthError('Please enter both your registered name and unique access PIN.');
      return;
    }

    setVerifyingPin(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/auth/verify-pin', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: teacherName.trim(),
          pin: accessPin.trim().toUpperCase(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Invalid credentials.');
      }
      if (json.status === 'already_completed' && json.claim) {
        setActiveClaim(json.claim as TeacherClaim);
        document.getElementById('my-card')?.scrollIntoView({ behavior: 'smooth' });
      } else if (json.status === 'ready_to_draw') {
        setVerifiedTeacher({
          participantId: json.participantId,
          displayName: json.displayName,
        });
        document.getElementById('gift-boxes')?.scrollIntoView({ behavior: 'smooth' });
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setVerifyingPin(false);
    }
  };

  const handleSelectBox = async (boxNumber: number) => {
    if (!user || !verifiedTeacher || openingBoxNumber !== null) return;
    setBoxError(null);
    setOpeningBoxNumber(boxNumber);

    try {
      const token = await user.getIdToken();
      // Keep lid-opening excitement animation visible for at least 1100ms while server commits atomically
      const [res] = await Promise.all([
        fetch('/api/exchange/open-box', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: teacherName.trim(),
            pin: accessPin.trim().toUpperCase(),
            boxNumber,
          }),
        }),
        new Promise((resolve) => setTimeout(resolve, 1100)),
      ]);

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Could not open this gift box.');
      }

      if (json.claim) {
        setActiveClaim(json.claim as TeacherClaim);
      }
      await loadExchangeState(user);
      setTimeout(() => {
        document.getElementById('my-card')?.scrollIntoView({ behavior: 'smooth' });
      }, 150);
    } catch (err) {
      setBoxError(err instanceof Error ? err.message : 'Could not complete box selection.');
      await loadExchangeState(user);
    } finally {
      setOpeningBoxNumber(null);
    }
  };

  const isAdmin = Boolean(exchangeState?.isAdmin);
  const meta = exchangeState?.meta;
  const boxes = exchangeState?.boxes || [];
  const canSelectBox = Boolean(user && verifiedTeacher && !activeClaim && meta?.isOpen);

  return (
    <div className="relative min-h-screen bg-[#081812] text-[#FAF6EE]">
      <Snowfall />

      {/* Top Navigation Bar (Strict 3-Zone Contract) */}
      <header className="sticky top-0 z-30 border-b border-[#D4AF37]/20 bg-[#081812]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-4 py-3.5 sm:px-6 lg:px-8">
          <a
            href="#top"
            className="font-display text-lg font-bold tracking-tight text-[#FAF6EE] whitespace-nowrap shrink-0 sm:text-xl"
          >
            The Christmas Gift Exchange
          </a>

          <nav className="hidden items-center gap-5 text-sm font-medium text-[#D8CEBE] sm:flex">
            <a
              href="#how-it-works"
              className="transition-colors hover:text-[#F3D878] whitespace-nowrap shrink-0"
            >
              How It Works
            </a>
            <a
              href="#gift-boxes"
              className="transition-colors hover:text-[#F3D878] whitespace-nowrap shrink-0"
            >
              Gift Boxes
            </a>
            {activeClaim && (
              <a
                href="#my-card"
                className="transition-colors hover:text-[#F3D878] whitespace-nowrap shrink-0"
              >
                My Card
              </a>
            )}
            {isAdmin && (
              <a
                href="#organiser"
                className="transition-colors hover:text-[#F3D878] whitespace-nowrap shrink-0"
              >
                Organiser
              </a>
            )}
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            {!authReady ? (
              <span className="text-xs text-[#D8CEBE] whitespace-nowrap">Connecting...</span>
            ) : user ? (
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-xl border border-[#D4AF37]/35 bg-[#102A21] px-4 py-2 text-xs font-medium text-[#FAF6EE] transition-colors hover:bg-[#16382D] whitespace-nowrap shrink-0"
              >
                <LogOut className="h-3.5 w-3.5 text-[#E8CC75]" />
                <span>Sign Out</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-xl bg-[#7A1C2E] px-4 py-2 text-xs font-semibold text-[#FAF6EE] transition-colors hover:bg-[#631423] whitespace-nowrap shrink-0"
              >
                <LogIn className="h-3.5 w-3.5" />
                <span>Sign In</span>
              </button>
            )}
          </div>
        </div>

        {/* Mobile / Narrow-Pane Navigation Bar */}
        <nav
          aria-label="Mobile navigation"
          className="flex items-center gap-5 overflow-x-auto border-t border-[#D4AF37]/15 px-4 py-2 text-xs font-medium text-[#D8CEBE] sm:hidden"
        >
          <a
            href="#how-it-works"
            className="transition-colors hover:text-[#F3D878] whitespace-nowrap shrink-0"
          >
            How It Works
          </a>
          <a
            href="#gift-boxes"
            className="transition-colors hover:text-[#F3D878] whitespace-nowrap shrink-0"
          >
            Gift Boxes
          </a>
          {activeClaim && (
            <a
              href="#my-card"
              className="transition-colors hover:text-[#F3D878] whitespace-nowrap shrink-0"
            >
              My Card
            </a>
          )}
          {isAdmin && (
            <a
              href="#organiser"
              className="font-semibold text-[#F3D878] transition-colors hover:text-[#FAF6EE] whitespace-nowrap shrink-0"
            >
              Organiser
            </a>
          )}
        </nav>

        <ChristmasLights />
      </header>

      <main id="top" className="relative z-20">
        {/* Hero Split Section */}
        <section className="mx-auto max-w-6xl px-4 pb-12 pt-8 sm:px-6 sm:pt-12 lg:px-8">
          <div className="grid items-stretch gap-8 lg:grid-cols-12">
            {/* Left: Editorial Headline + Teacher Verification Card */}
            <div className="flex flex-col justify-between lg:col-span-6">
              <div>
                <p className="text-sm font-medium text-[#E8CC75]">
                  Staffroom Secret Santa · 20 Teachers
                </p>
                <h1 className="mt-2 font-display text-4xl font-bold leading-tight tracking-tight text-[#FAF6EE] text-balance sm:text-5xl">
                  The Christmas Gift Exchange
                </h1>
                <p className="mt-2 font-display text-xl italic text-[#F3D878]">
                  A Little Gift, A Lot of Love.
                </p>
                <p className="mt-4 max-w-xl text-base leading-relaxed text-[#D8CEBE]">
                  Enter your registered name and personal access PIN to unlock the mystery gift boxes, unwrap your secret colleague assignment, and save your personalised Christmas card.
                </p>
              </div>

              {/* Entry Card */}
              <div className="mt-8 rounded-2xl border border-[#D4AF37]/30 bg-[#0F2920] p-6 shadow-xl">
                {!user ? (
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <Shield className="mt-0.5 h-5 w-5 shrink-0 text-[#E8CC75]" />
                      <div>
                        <h2 className="font-display text-xl font-semibold text-[#FAF6EE]">
                          Verify Your Account to Begin
                        </h2>
                        <p className="mt-1 text-sm text-[#D8CEBE]">
                          Sign in with Google so your Secret Santa draw is permanently linked to your account and protected against impersonation.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleGoogleSignIn}
                      className="flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#7A1C2E] px-6 py-3 text-sm font-semibold text-[#FAF6EE] shadow-lg transition-colors hover:bg-[#631423] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3D878]"
                    >
                      <LogIn className="h-4 w-4" />
                      <span>Continue with Google</span>
                    </button>
                  </div>
                ) : activeClaim ? (
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#F3D878]" />
                      <div>
                        <h2 className="font-display text-xl font-semibold text-[#FAF6EE]">
                          Welcome Back, {activeClaim.displayName}
                        </h2>
                        <p className="mt-1 text-sm text-[#D8CEBE]">
                          You have already unwrapped Mystery Box #{String(activeClaim.boxNumber).padStart(2, '0')}. Your personalised greeting card is displayed below.
                        </p>
                      </div>
                    </div>
                    <a
                      href="#my-card"
                      className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#7A1C2E] px-5 py-2.5 text-sm font-semibold text-[#FAF6EE] transition-colors hover:bg-[#631423]"
                    >
                      <Gift className="h-4 w-4" />
                      <span>View &amp; Download My Greeting Card</span>
                    </a>
                  </div>
                ) : !meta?.isInitialized ? (
                  <div className="space-y-3 text-sm text-[#D8CEBE]">
                    <p className="font-semibold text-[#FAF6EE]">
                      Signed in as {user.email}
                    </p>
                    <p>
                      {loadingState
                        ? 'Checking exchange status...'
                        : isAdmin
                        ? 'The 20-teacher exchange has not been initialized yet. Use the Organiser Control Center below to generate the Secret Santa pairings and access PINs.'
                        : 'The organiser has not opened the Christmas Gift Exchange yet. Please check back shortly.'}
                    </p>
                    {isAdmin && (
                      <a
                        href="#organiser"
                        className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#7A1C2E] px-5 py-2.5 text-sm font-semibold text-[#FAF6EE] transition-colors hover:bg-[#631423]"
                      >
                        <span>Go to Organiser Control Center</span>
                      </a>
                    )}
                  </div>
                ) : (
                  <form onSubmit={handleVerifyPin} className="space-y-4">
                    <div className="flex items-center justify-between gap-2 border-b border-[#D4AF37]/15 pb-3">
                      <span className="truncate text-xs font-medium text-[#E8CC75]">
                        Signed in as {user.email}
                      </span>
                      <div className="flex items-center gap-3 shrink-0">
                        {isAdmin && (
                          <a
                            href="#organiser"
                            className="text-xs font-semibold text-[#F3D878] underline underline-offset-4 hover:text-[#FAF6EE]"
                          >
                            Organiser Center
                          </a>
                        )}
                        {verifiedTeacher && (
                          <span className="flex items-center gap-1 text-xs font-medium text-[#F3D878]">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>Verified</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="teacher-name"
                        className="block text-xs font-medium text-[#D8CEBE]"
                      >
                        Registered Teacher Name
                      </label>
                      <input
                        id="teacher-name"
                        type="text"
                        required
                        value={teacherName}
                        onChange={(e) => {
                          setTeacherName(e.target.value);
                          setVerifiedTeacher(null);
                        }}
                        placeholder="e.g. Mrs. Esther Francis"
                        className="mt-1.5 min-h-[44px] w-full rounded-xl border border-[#D4AF37]/30 bg-[#081812] px-4 py-2.5 text-sm text-[#FAF6EE] placeholder:text-[#D8CEBE]/45 focus:border-[#F3D878] focus:outline-none"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="access-pin"
                        className="block text-xs font-medium text-[#D8CEBE]"
                      >
                        Unique Access PIN
                      </label>
                      <input
                        id="access-pin"
                        type="text"
                        required
                        maxLength={12}
                        value={accessPin}
                        onChange={(e) => {
                          setAccessPin(e.target.value.toUpperCase());
                          setVerifiedTeacher(null);
                        }}
                        placeholder="6-character PIN (e.g. K7M9P2)"
                        className="font-mono-tabular mt-1.5 min-h-[44px] w-full rounded-xl border border-[#D4AF37]/30 bg-[#081812] px-4 py-2.5 text-sm uppercase tracking-widest text-[#F3D878] placeholder:normal-case placeholder:tracking-normal placeholder:text-[#D8CEBE]/45 focus:border-[#F3D878] focus:outline-none"
                      />
                    </div>

                    {authError && (
                      <div className="flex items-start gap-2 rounded-xl border border-[#B42A43]/60 bg-[#4A0D19]/70 px-3.5 py-2.5 text-xs text-[#FAF6EE]">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#F3D878]" />
                        <span>{authError}</span>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={verifyingPin || !meta.isOpen}
                      className="flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#7A1C2E] px-6 py-3 text-sm font-semibold text-[#FAF6EE] shadow-lg transition-colors hover:bg-[#631423] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3D878] disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <KeyRound className="h-4 w-4" />
                      <span>
                        {!meta.isOpen
                          ? 'Participation Closed'
                          : verifyingPin
                          ? 'Validating Credentials...'
                          : verifiedTeacher
                          ? `Verified as ${verifiedTeacher.displayName}`
                          : 'Unlock Mystery Gift Boxes'}
                      </span>
                    </button>
                  </form>
                )}

                {!user && authError && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl border border-[#B42A43]/60 bg-[#4A0D19]/70 px-3.5 py-2.5 text-xs text-[#FAF6EE]">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#F3D878]" />
                    <span>{authError}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Hero Editorial Artwork */}
            <div className="lg:col-span-6">
              <div className="relative h-full min-h-[340px] overflow-hidden rounded-3xl border border-[#D4AF37]/30 bg-[#0E261E] shadow-2xl">
                {!heroImgFailed ? (
                  <img
                    src="/src/assets/images/hero_christmas_atelier_1794843528481.jpg"
                    alt="Luxury green and burgundy Christmas gift boxes tied with antique gold ribbons by candlelight"
                    referrerPolicy="no-referrer"
                    onError={() => setHeroImgFailed(true)}
                    className="h-full w-full object-cover lg:h-full"
                  />
                ) : (
                  <div className="flex h-full min-h-[340px] items-center justify-center bg-gradient-to-br from-[#133A2E] via-[#0B211A] to-[#4A0D19] p-8 text-center">
                    <Gift className="h-16 w-16 text-[#D4AF37]" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[#071611]/90 via-[#071611]/25 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8">
                  <p className="text-xs font-medium text-[#E8CC75]">
                    20 Teachers · 20 Mystery Boxes · 1 Heartfelt Exchange
                  </p>
                  <p className="mt-1 font-display text-xl font-semibold text-[#FAF6EE]">
                    Each box reveals one colleague assigned exclusively to you.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works (Clean 3-step editorial row) */}
        <section
          id="how-it-works"
          className="border-y border-[#D4AF37]/15 bg-[#0A1E17] py-10"
        >
          <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:grid-cols-3 sm:px-6 lg:px-8">
            <div>
              <p className="font-mono-tabular text-xs font-semibold text-[#E8CC75]">
                01. Enter Credentials
              </p>
              <h3 className="mt-1.5 font-display text-lg font-semibold text-[#FAF6EE]">
                Verify Name &amp; PIN
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-[#D8CEBE]">
                Sign in and enter your registered faculty name and private 6-character PIN provided by the organiser.
              </p>
            </div>
            <div>
              <p className="font-mono-tabular text-xs font-semibold text-[#E8CC75]">
                02. Unwrap a Box
              </p>
              <h3 className="mt-1.5 font-display text-lg font-semibold text-[#FAF6EE]">
                Select One Mystery Present
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-[#D8CEBE]">
                Pick any unopened gift box from the festive grid. Atomic locking guarantees no two teachers ever draw twice.
              </p>
            </div>
            <div>
              <p className="font-mono-tabular text-xs font-semibold text-[#E8CC75]">
                03. Save Your Card
              </p>
              <h3 className="mt-1.5 font-display text-lg font-semibold text-[#FAF6EE]">
                Download PNG Keepsake
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-[#D8CEBE]">
                Reveal your Secret Santa recipient and download a personalised Christmas greeting card ready for WhatsApp.
              </p>
            </div>
          </div>
        </section>

        {/* Box Selection Error Banner */}
        {boxError && (
          <div className="mx-auto mt-6 max-w-4xl px-4">
            <div className="flex items-start gap-2.5 rounded-xl border border-[#B42A43] bg-[#4A0D19]/85 px-4 py-3 text-sm text-[#FAF6EE]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#F3D878]" />
              <span>{boxError}</span>
            </div>
          </div>
        )}

        {/* Personalised Greeting Card (Shown immediately when revealed or returning!) */}
        {activeClaim && <GreetingCard claim={activeClaim} />}

        {/* Mystery Gift Box Grid (Shown whenever initialized) */}
        {boxes.length > 0 && (
          <GiftBoxGrid
            boxes={boxes}
            canSelect={canSelectBox}
            isOpen={Boolean(meta?.isOpen)}
            openingBoxNumber={openingBoxNumber}
            onSelectBox={handleSelectBox}
          />
        )}

        {/* Protected Organiser Dashboard */}
        {isAdmin && (
          <OrganiserDashboard
            getIdToken={getIdToken}
            onExchangeUpdated={() => loadExchangeState(user)}
          />
        )}
      </main>

      <footer className="relative z-20 border-t border-[#D4AF37]/15 bg-[#06130E] py-8 text-center text-xs text-[#D8CEBE]">
        <div className="mx-auto max-w-6xl px-4">
          <p className="font-display text-sm font-semibold text-[#FAF6EE]">
            The Christmas Gift Exchange · A Little Gift, A Lot of Love.
          </p>
          <p className="mt-1.5 text-[#D8CEBE]/75">
            Private faculty Secret Santa portal · Assignments are encrypted and stored in Cloud Firestore.
          </p>
        </div>
      </footer>
    </div>
  );
}
