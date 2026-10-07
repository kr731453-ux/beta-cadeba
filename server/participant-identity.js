export function normalizeDni(value, required = false) {
  const dni = String(value ?? '')
    .trim()
    .replace(/[.\s]/g, '');
  if (!dni && !required) return null;
  if (!/^[1-9]\d{5,8}$/.test(dni))
    throw Object.assign(new Error('Ingresá el DNI con entre 6 y 9 dígitos, sin letras.'), {
      status: 400,
    });
  return dni;
}
