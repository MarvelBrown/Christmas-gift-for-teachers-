import type { TeacherClaim } from '../types';

const WREATH_BG_URL = '/src/assets/images/greeting_card_wreath_1794843528422.jpg';

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function renderGreetingCardBlob(claim: TeacherClaim): Promise<Blob> {
  if (typeof document !== 'undefined' && 'fonts' in document) {
    try {
      await document.fonts.ready;
    } catch {
      // Proceed with fallback fonts
    }
  }

  const width = 1080;
  const height = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize canvas context.');
  }

  // Base deep forest green backdrop
  ctx.fillStyle = '#0D261E';
  ctx.fillRect(0, 0, width, height);

  // Subtle gold outer frame
  ctx.strokeStyle = '#D4AF37';
  ctx.lineWidth = 4;
  ctx.strokeRect(28, 28, width - 56, height - 56);

  // Load botanical stationery background
  const bg = await loadImage(WREATH_BG_URL);
  if (bg) {
    // Center crop onto inner stationery sheet (x=54, y=54, w=972, h=1242)
    const targetX = 54;
    const targetY = 54;
    const targetW = width - 108;
    const targetH = height - 108;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(targetX, targetY, targetW, targetH, 16);
    ctx.clip();

    const imgRatio = bg.width / bg.height;
    const boxRatio = targetW / targetH;
    let drawW = targetW;
    let drawH = targetH;
    let drawX = targetX;
    let drawY = targetY;

    if (imgRatio > boxRatio) {
      drawW = targetH * imgRatio;
      drawX = targetX - (drawW - targetW) / 2;
    } else {
      drawH = targetW / imgRatio;
      drawY = targetY - (drawH - targetH) / 2;
    }
    ctx.drawImage(bg, drawX, drawY, drawW, drawH);
    ctx.restore();
  } else {
    // Cream parchment fallback
    ctx.fillStyle = '#FAF6EE';
    ctx.beginPath();
    ctx.roundRect(54, 54, width - 108, height - 108, 16);
    ctx.fill();
  }

  // Soft warm cream medallion inside the botanical wreath so text always reads at >7:1 contrast
  ctx.save();
  ctx.fillStyle = 'rgba(250, 246, 238, 0.94)';
  ctx.shadowColor = 'rgba(13, 38, 30, 0.14)';
  ctx.shadowBlur = 36;
  ctx.beginPath();
  ctx.roundRect(156, 178, width - 312, height - 356, 24);
  ctx.fill();
  ctx.restore();

  // Inner antique gold hairline border
  ctx.strokeStyle = 'rgba(166, 124, 30, 0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(174, 196, width - 348, height - 392, 18);
  ctx.stroke();

  ctx.textAlign = 'center';

  // Header kicker
  ctx.fillStyle = '#7A1C2E';
  ctx.font = '600 24px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText('SEASON’S GREETINGS · STAFFROOM SECRET SANTA', width / 2, 266);

  // Main title
  ctx.fillStyle = '#10261F';
  ctx.font = '700 46px "Playfair Display", Georgia, serif';
  ctx.fillText('The Christmas Gift Exchange', width / 2, 330);

  // Tagline
  ctx.fillStyle = '#8B6914';
  ctx.font = 'italic 500 26px "Playfair Display", Georgia, serif';
  ctx.fillText('A Little Gift, A Lot of Love.', width / 2, 374);

  // Gold divider rule
  ctx.strokeStyle = 'rgba(166, 124, 30, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(310, 412);
  ctx.lineTo(width - 310, 412);
  ctx.stroke();

  // From line
  ctx.fillStyle = '#4E473E';
  ctx.font = '500 25px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(`Prepared especially for ${claim.displayName}`, width / 2, 474);

  // Recipient callout box
  ctx.fillStyle = '#0D2B22';
  ctx.beginPath();
  ctx.roundRect(224, 520, width - 448, 238, 18);
  ctx.fill();

  ctx.strokeStyle = '#D4AF37';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(234, 530, width - 468, 218, 14);
  ctx.stroke();

  ctx.fillStyle = '#E8CC75';
  ctx.font = '600 21px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText('YOU ARE SECRET SANTA FOR', width / 2, 594);

  ctx.fillStyle = '#FAF6EE';
  ctx.font = '700 50px "Playfair Display", Georgia, serif';
  const recipientLines = wrapText(ctx, claim.recipientName, width - 520);
  if (recipientLines.length === 1) {
    ctx.fillText(recipientLines[0], width / 2, 676);
  } else {
    ctx.font = '700 40px "Playfair Display", Georgia, serif';
    ctx.fillText(recipientLines[0], width / 2, 654);
    ctx.fillText(recipientLines.slice(1).join(' '), width / 2, 706);
  }

  // Selected Box note
  ctx.fillStyle = '#7A1C2E';
  ctx.font = '600 24px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(`Mystery Gift Box #${String(claim.boxNumber).padStart(2, '0')} · Private Keep-Safe Card`, width / 2, 822);

  // Personalised festive message
  ctx.fillStyle = '#2B2925';
  ctx.font = 'italic 500 28px "Playfair Display", Georgia, serif';
  const msgLines = wrapText(ctx, `"${claim.cardMessage}"`, width - 440);
  let msgY = 888;
  for (const line of msgLines) {
    ctx.fillText(line, width / 2, msgY);
    msgY += 42;
  }

  // Burgundy wax seal emblem at bottom
  const sealY = 1074;
  ctx.fillStyle = '#7A1C2E';
  ctx.beginPath();
  ctx.arc(width / 2, sealY, 44, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#D4AF37';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(width / 2, sealY, 36, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#FAF6EE';
  ctx.font = '700 26px "Playfair Display", Georgia, serif';
  ctx.fillText('2026', width / 2, sealY + 9);

  // Footer note
  ctx.fillStyle = '#5C5449';
  ctx.font = '500 20px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText('Please keep this recipient secret until gift exchange day.', width / 2, 1152);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to export PNG greeting card.'));
      }
    }, 'image/png');
  });
}
