import { useState } from 'react';
import { Download, Gift, Share2, Check } from 'lucide-react';
import { motion } from 'motion/react';
import type { TeacherClaim } from '../types';
import { renderGreetingCardBlob } from '../utils/cardCanvas';

interface GreetingCardProps {
  claim: TeacherClaim;
}

export function GreetingCard({ claim }: GreetingCardProps) {
  const [downloading, setDownloading] = useState(false);
  const [sharedFeedback, setSharedFeedback] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  const handleDownloadPng = async () => {
    setDownloading(true);
    setSharedFeedback(null);
    try {
      const blob = await renderGreetingCardBlob(claim);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeSlug = claim.displayName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      a.download = `christmas-gift-card-${safeSlug || 'teacher'}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setSharedFeedback('Card downloaded as PNG');
    } catch (err) {
      setSharedFeedback(err instanceof Error ? err.message : 'Unable to export PNG.');
    } finally {
      setDownloading(false);
    }
  };

  const handleShareCard = async () => {
    setDownloading(true);
    setSharedFeedback(null);
    try {
      const blob = await renderGreetingCardBlob(claim);
      const file = new File([blob], 'christmas-gift-exchange-card.png', {
        type: 'image/png',
      });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'The Christmas Gift Exchange',
          text: `My Secret Santa greeting card from The Christmas Gift Exchange.`,
          files: [file],
        });
        setSharedFeedback('Card shared successfully');
      } else {
        await handleDownloadPng();
        setSharedFeedback('PNG saved — ready to attach in WhatsApp');
      }
    } catch {
      // User cancelled share sheet or browser does not support file share
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section id="my-card" className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="grid items-center gap-8 rounded-3xl border border-[#D4AF37]/30 bg-[#0E261E] p-6 shadow-2xl shadow-black/40 sm:p-10 lg:grid-cols-12"
      >
        {/* Left: Luxury Visual Greeting Card Preview */}
        <div className="lg:col-span-7">
          <div className="relative mx-auto max-w-md overflow-hidden rounded-2xl border-2 border-[#D4AF37]/60 bg-[#FAF6EE] shadow-xl">
            {!imgFailed ? (
              <img
                src="/src/assets/images/greeting_card_wreath_1794843528422.jpg"
                alt="Botanical Christmas greeting card wreath border"
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                className="h-full w-full object-cover opacity-90"
              />
            ) : (
              <div className="aspect-[3/4] w-full bg-[#FAF6EE]" />
            )}

            {/* Inner Warm Parchment Medallion */}
            <div className="absolute inset-4 flex flex-col items-center justify-center rounded-xl border border-[#8B6914]/35 bg-[#FAF6EE]/94 px-5 py-6 text-center shadow-sm sm:inset-7 sm:px-7">
              <p className="text-[11px] font-semibold tracking-wider text-[#7A1C2E]">
                SEASON’S GREETINGS · SECRET SANTA
              </p>

              <h3 className="mt-2 font-display text-2xl font-bold text-[#10261F] sm:text-3xl">
                The Christmas Gift Exchange
              </h3>
              <p className="mt-1 font-display text-sm italic text-[#8B6914]">
                A Little Gift, A Lot of Love.
              </p>

              <div className="my-3 h-px w-24 bg-[#D4AF37]/60" />

              <p className="text-xs font-medium text-[#4E473E]">
                Prepared for {claim.displayName}
              </p>

              {/* High-contrast forest green recipient plaque */}
              <div className="mt-3 w-full rounded-xl border border-[#D4AF37]/70 bg-[#0D2B22] px-4 py-5 text-[#FAF6EE] shadow-md">
                <p className="text-[10px] font-semibold tracking-wider text-[#E8CC75]">
                  YOU ARE BUYING A GIFT FOR
                </p>
                <p className="mt-2 font-display text-2xl font-bold text-[#FAF6EE] sm:text-3xl">
                  {claim.recipientName}
                </p>
              </div>

              <p className="mt-3 font-mono-tabular text-xs font-semibold text-[#7A1C2E]">
                Mystery Box #{String(claim.boxNumber).padStart(2, '0')}
              </p>

              <p className="mt-2.5 font-display text-xs italic leading-relaxed text-[#2B2925] sm:text-sm">
                “{claim.cardMessage}”
              </p>

              <div className="mt-4 flex h-10 w-10 items-center justify-center rounded-full border border-[#D4AF37] bg-[#7A1C2E] font-display text-xs font-bold text-[#FAF6EE] shadow">
                2026
              </div>
            </div>
          </div>
        </div>

        {/* Right: Reveal Summary & PNG Download Controls */}
        <div className="flex flex-col justify-center lg:col-span-5">
          <div className="flex items-center gap-2 text-sm font-medium text-[#E8CC75]">
            <Gift className="h-4 w-4" />
            <span>Your Mystery Box Has Been Revealed</span>
          </div>

          <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-[#FAF6EE]">
            Keep It Secret, Keep It Special
          </h2>

          <p className="mt-3 text-base leading-relaxed text-[#D8CEBE]">
            Your Secret Santa assignment is permanently saved to your account. Whenever you return to this page, your greeting card will be waiting right here.
          </p>

          <dl className="mt-6 space-y-3 border-y border-[#D4AF37]/20 py-5 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[#D8CEBE]">Your Name</dt>
              <dd className="font-semibold text-[#FAF6EE]">{claim.displayName}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[#D8CEBE]">Gift Recipient</dt>
              <dd className="font-semibold text-[#F3D878]">{claim.recipientName}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[#D8CEBE]">Selected Box</dt>
              <dd className="font-mono-tabular text-[#FAF6EE]">
                Box #{String(claim.boxNumber).padStart(2, '0')}
              </dd>
            </div>
          </dl>

          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              disabled={downloading}
              onClick={handleDownloadPng}
              className="flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#7A1C2E] px-6 py-3 text-sm font-semibold text-[#FAF6EE] shadow-lg transition-colors hover:bg-[#631423] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3D878] disabled:opacity-60 whitespace-nowrap"
            >
              <Download className="h-4 w-4" />
              <span>{downloading ? 'Preparing High-Res Card...' : 'Download Greeting Card (PNG)'}</span>
            </button>

            <button
              type="button"
              disabled={downloading}
              onClick={handleShareCard}
              className="flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#D4AF37]/45 bg-[#123328] px-5 py-2.5 text-sm font-medium text-[#FAF6EE] transition-colors hover:bg-[#194235] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F3D878] disabled:opacity-60 whitespace-nowrap"
            >
              <Share2 className="h-4 w-4 text-[#E8CC75]" />
              <span>Share Card for WhatsApp</span>
            </button>

            {sharedFeedback && (
              <p className="flex items-center justify-center gap-1.5 text-xs font-medium text-[#E8CC75]">
                <Check className="h-3.5 w-3.5" />
                <span>{sharedFeedback}</span>
              </p>
            )}
          </div>
        </div>
      </motion.div>
    </section>
  );
}
