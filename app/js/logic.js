// Pure logic shared by browser and Node tests. No DOM, no I/O.

export function formatDateLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayLocal(now = new Date()) {
  return formatDateLocal(now);
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return formatDateLocal(new Date(y, m - 1, d + days));
}

export function sortByDate(entries) {
  return [...entries].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export const KG_PER_LB = 0.45359237;

export function kgToLbs(kg) {
  return kg / KG_PER_LB;
}

export function lbsToKg(lbs) {
  return lbs * KG_PER_LB;
}

export function parseWeightToKg(raw, unit) {
  const n = Number(String(raw).trim().replace(',', '.'));
  if (!Number.isFinite(n) || String(raw).trim() === '') {
    return { ok: false, error: 'Enter a number' };
  }
  const kg = unit === 'lbs' ? lbsToKg(n) : n;
  if (kg < 30 || kg > 300) {
    return { ok: false, error: 'Weight out of range (30 to 300 kg)' };
  }
  return { ok: true, kg: Math.round(kg * 100) / 100 };
}
