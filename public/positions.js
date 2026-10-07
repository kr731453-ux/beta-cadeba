// The administrator's notation "1/2" explicitly means one-and-a-half here.
export function parsePositions(value, label) {
  const text = String(label ?? value ?? '').trim(),
    normalized = text.toLowerCase().replace(/\s+/g, ' '),
    words = {
      uno: 1,
      una: 1,
      dos: 2,
      tres: 3,
      cuatro: 4,
      cinco: 5,
      seis: 6,
      siete: 7,
      ocho: 8,
      nueve: 9,
      diez: 10,
    };
  let quantity;
  if (typeof value === 'number' && label === undefined) quantity = value;
  else if (normalized === '½' || normalized === 'medio' || normalized === 'media') quantity = 0.5;
  else if (/^\d+(?:[.,]\d+)?$/.test(normalized)) quantity = Number(normalized.replace(',', '.'));
  else {
    let m = normalized.match(/^(\d+)\s*(?:\/\s*2|½|(?:y\s+)?medio|\s+1\s*\/\s*2)$/);
    if (m) quantity = Number(m[1]) + 0.5;
    else {
      m = normalized.match(/^(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez) y medio$/);
      if (m) quantity = words[m[1]] + 0.5;
      else if (words[normalized]) quantity = words[normalized];
    }
  }
  if (
    !Number.isFinite(quantity) ||
    !Number.isInteger(quantity * 2) ||
    quantity < 0.5 ||
    quantity > 100 ||
    (typeof value === 'number' && Math.abs(quantity - value) > 0)
  )
    throw Error(
      'Usá puestos completos o medios. Ejemplos: 1, 1/2 (uno y medio), 2 y medio, o ½ (medio).',
    );
  return {
    quantity,
    label:
      quantity === 0.5
        ? '½'
        : typeof value === 'number' && label === undefined
          ? positionLabel(quantity)
          : text,
  };
}
export function positionLabel(quantity, label) {
  if (quantity === 0.5) return '½';
  if (label) return label;
  if (quantity % 1 === 0.5) return Math.floor(quantity) + ' y medio';
  return String(quantity);
}
export const dniText = (value) =>
  value ? String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : 'DNI pendiente';
