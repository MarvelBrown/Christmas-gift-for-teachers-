import { CheckCircle2, Gift, Lock } from 'lucide-react';
import { motion } from 'motion/react';
import type { MysteryBoxItem } from '../types';

interface GiftBoxGridProps {
  boxes: MysteryBoxItem[];
  canSelect: boolean;
  isOpen: boolean;
  openingBoxNumber: number | null;
  onSelectBox: (boxNumber: number) => void;
}

const BOX_THEMES: Record<
  MysteryBoxItem['ribbonStyle'],
  {
    bodyBg: string;
    lidBg: string;
    ribbonBg: string;
    border: string;
    numText: string;
  }
> = {
  burgundy: {
    bodyBg: 'bg-gradient-to-b from-[#6E1728] to-[#4A0D19]',
    lidBg: 'bg-gradient-to-b from-[#821E32] to-[#621423]',
    ribbonBg: 'bg-gradient-to-r from-[#C89D2B] via-[#F2D572] to-[#C89D2B]',
    border: 'border-[#D4AF37]/40',
    numText: 'text-[#FAF6EE]',
  },
  forest: {
    bodyBg: 'bg-gradient-to-b from-[#164234] to-[#0B241C]',
    lidBg: 'bg-gradient-to-b from-[#1D5342] to-[#11352A]',
    ribbonBg: 'bg-gradient-to-r from-[#8D1E32] via-[#B42A43] to-[#8D1E32]',
    border: 'border-[#D4AF37]/35',
    numText: 'text-[#FAF6EE]',
  },
  gold: {
    bodyBg: 'bg-gradient-to-b from-[#9E7822] to-[#6E5111]',
    lidBg: 'bg-gradient-to-b from-[#B88E2E] to-[#8A671A]',
    ribbonBg: 'bg-gradient-to-r from-[#5E1322] via-[#7A1C2E] to-[#5E1322]',
    border: 'border-[#FAF6EE]/35',
    numText: 'text-[#FAF6EE]',
  },
  ivory: {
    bodyBg: 'bg-gradient-to-b from-[#EFE7D6] to-[#DDD1B8]',
    lidBg: 'bg-gradient-to-b from-[#FAF6EE] to-[#E8DEC8]',
    ribbonBg: 'bg-gradient-to-r from-[#133A2E] via-[#1C5443] to-[#133A2E]',
    border: 'border-[#8B6914]/35',
    numText: 'text-[#10261F]',
  },
};

export function GiftBoxGrid({
  boxes,
  canSelect,
  isOpen,
  openingBoxNumber,
  onSelectBox,
}: GiftBoxGridProps) {
  const unopenedCount = boxes.filter((b) => b.status === 'unopened').length;

  return (
    <section id="gift-boxes" className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col gap-3 border-b border-[#D4AF37]/20 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-[#E8CC75]">
            Twenty Mystery Presents
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-[#FAF6EE] sm:text-3xl">
            Choose a Mystery Gift Box
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-[#D8CEBE]">
          <span className="font-mono-tabular">
            {unopenedCount} of {boxes.length} unopened
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {!isOpen
              ? 'Participation closed'
              : canSelect
              ? 'Tap any unopened box to reveal your recipient'
              : 'Validate your Name & PIN above to unlock selection'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5 lg:gap-5">
        {boxes.map((box) => {
          const theme = BOX_THEMES[box.ribbonStyle] || BOX_THEMES.burgundy;
          const isOpened = box.status === 'opened';
          const isOpening = openingBoxNumber === box.boxNumber;
          const isDisabled = !canSelect || !isOpen || isOpened || openingBoxNumber !== null;

          return (
            <motion.button
              key={box.boxId}
              type="button"
              disabled={isDisabled}
              onClick={() => onSelectBox(box.boxNumber)}
              whileHover={!isDisabled ? { y: -6, scale: 1.02 } : undefined}
              whileTap={!isDisabled ? { scale: 0.97 } : undefined}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              aria-label={`Mystery Gift Box ${box.boxNumber}, ${isOpened ? 'already opened' : 'unopened'}`}
              className={`group relative flex min-h-[168px] flex-col items-center justify-between rounded-2xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3D878] ${
                isOpened
                  ? 'cursor-not-allowed border-[#FAF6EE]/10 bg-[#0D211A]/60 opacity-55'
                  : canSelect && isOpen
                  ? 'cursor-pointer border-[#D4AF37]/35 bg-[#102A21] shadow-lg shadow-black/25 hover:border-[#F3D878]/75 hover:bg-[#14352A]'
                  : 'cursor-not-allowed border-[#D4AF37]/20 bg-[#0D241C]/80 opacity-85'
              }`}
            >
              {/* Box Number & Status Row */}
              <div className="flex w-full items-center justify-between text-xs">
                <span className="font-mono-tabular font-semibold text-[#E8CC75]">
                  #{String(box.boxNumber).padStart(2, '0')}
                </span>
                <span className="flex items-center gap-1 text-[#D8CEBE]">
                  {isOpened ? (
                    <>
                      {box.isMine ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-[#F3D878]" />
                      ) : (
                        <Lock className="h-3.5 w-3.5 text-[#D8CEBE]" />
                      )}
                      <span>{box.isMine ? 'Yours' : 'Claimed'}</span>
                    </>
                  ) : (
                    <span>{canSelect && isOpen ? 'Ready' : 'Sealed'}</span>
                  )}
                </span>
              </div>

              {/* 3D Animated Gift Box Illustration */}
              <div
                className={`relative my-3 flex h-24 w-24 items-center justify-center ${
                  isOpening ? 'animate-box-wobble' : ''
                }`}
              >
                {/* Warm celebration burst when opening */}
                {isOpening && (
                  <motion.div
                    initial={{ scale: 0.5, opacity: 0.9 }}
                    animate={{ scale: 1.85, opacity: 0 }}
                    transition={{ duration: 0.9, repeat: Infinity }}
                    className="absolute inset-0 rounded-full bg-[#F3D878]/40 blur-md"
                  />
                )}

                {/* Bow loops */}
                <motion.div
                  animate={isOpening ? { y: -18, rotate: -14, opacity: 0 } : { y: 0, rotate: 0, opacity: 1 }}
                  transition={{ duration: 0.45 }}
                  className="relative flex flex-col items-center"
                >
                  <div className="relative z-20 -mb-1 flex items-center justify-center">
                    <span
                      className={`h-3.5 w-5 -rotate-12 rounded-full border border-black/15 ${theme.ribbonBg}`}
                    />
                    <span
                      className={`h-3 w-3 rounded-full border border-black/20 ${theme.ribbonBg}`}
                    />
                    <span
                      className={`h-3.5 w-5 rotate-12 rounded-full border border-black/15 ${theme.ribbonBg}`}
                    />
                  </div>

                  {/* Lid */}
                  <div
                    className={`relative z-10 h-5 w-20 rounded-md border shadow-md ${theme.lidBg} ${theme.border}`}
                  >
                    <span className={`absolute inset-y-0 left-1/2 w-3.5 -translate-x-1/2 ${theme.ribbonBg}`} />
                  </div>
                </motion.div>

                {/* Box Body */}
                <div
                  className={`absolute bottom-1 flex h-14 w-[72px] items-center justify-center rounded-b-lg border shadow-inner ${theme.bodyBg} ${theme.border} ${
                    isOpened ? 'opacity-65' : ''
                  }`}
                >
                  {/* Vertical Ribbon */}
                  <span className={`absolute inset-y-0 left-1/2 w-3.5 -translate-x-1/2 ${theme.ribbonBg}`} />
                  {/* Horizontal Ribbon */}
                  <span className={`absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 ${theme.ribbonBg}`} />
                  <span
                    className={`relative z-10 rounded bg-black/35 px-1.5 py-0.5 font-mono-tabular text-xs font-semibold text-[#FAF6EE]`}
                  >
                    {String(box.boxNumber).padStart(2, '0')}
                  </span>
                </div>
              </div>

              {/* Footer Action Hint */}
              <div className="flex w-full items-center justify-center gap-1.5 text-xs font-medium">
                {isOpening ? (
                  <span className="text-[#F3D878]">Unwrapping...</span>
                ) : isOpened ? (
                  <span className="text-[#D8CEBE]/75">
                    {box.isMine ? 'Your Selected Box' : 'Already Opened'}
                  </span>
                ) : canSelect && isOpen ? (
                  <span className="flex items-center gap-1.5 text-[#F3D878] group-hover:text-[#FAF6EE]">
                    <Gift className="h-3.5 w-3.5" />
                    <span>Open Gift Box</span>
                  </span>
                ) : (
                  <span className="text-[#D8CEBE]/80">Mystery Box</span>
                )}
              </div>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}
