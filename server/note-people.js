import { normalizeDni } from './participant-identity.js';
import { parsePositions } from '../public/positions.js';
const keyName = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es-AR');
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
export async function noteRegistry(env, chain) {
  return (
    await env.DB.prepare(
      "SELECT u.id,u.name,u.dni,m.quantity,m.half_units FROM users u LEFT JOIN members m ON m.user_id=u.id AND m.chain_id=? AND m.state='active' WHERE u.created_by=? AND NOT EXISTS(SELECT 1 FROM admins WHERE user_id=u.id)",
    )
      .bind(chain.id, chain.owner_id)
      .all()
  ).results;
}
export function groupNotePeople(value, people, { writing = false } = {}) {
  const legacy = value.version !== 2,
    groups = new Map(),
    byId = new Map(people.map((p) => [p.id, p])),
    updates = [];
  for (const input of value.rows || []) {
    let person = input.user_id ? byId.get(input.user_id) : null;
    if (input.user_id && !person && writing) fail(400, 'Elegí participantes de tu propia cuenta.');
    const providedDni = normalizeDni(input.dni);
    if (!person && providedDni) person = people.find((p) => p.dni === providedDni);
    if (!person && legacy) {
      const candidates = people.filter(
        (p) => p.quantity != null && keyName(p.name) === keyName(input.name),
      );
      if (candidates.length === 1) person = candidates[0];
    }
    let dni = person?.dni || providedDni || null;
    if (writing && person && (input.profile_dni_edit || input.profile_name_edit)) {
      if (input.profile_dni_edit) dni = normalizeDni(input.dni, true);
      if (dni && people.some((p) => p.id !== person.id && p.dni === dni))
        fail(409, 'Ese DNI pertenece a otra persona registrada. Revisá los datos.');
      updates.push({
        id: person.id,
        dni,
        name: input.profile_name_edit ? String(input.name).trim() : person.name,
      });
    }
    const identity = person
      ? 'user:' + person.id
      : dni
        ? 'dni:' + dni
        : 'name:' + keyName(input.name);
    let position;
    try {
      position = parsePositions(input.quantity, input.quantity_label);
    } catch (e) {
      fail(400, e.message);
    }
    const shared_group =
      typeof input.shared_group === 'string' && /^[\w-]{1,80}$/.test(input.shared_group)
        ? input.shared_group
        : null;
    const dates = Array.isArray(input.dates) ? input.dates : [String(input.date || '')];
    let row = groups.get(identity);
    if (!row) {
      row = {
        id: input.id,
        user_id: person?.id || null,
        name:
          writing && input.profile_name_edit
            ? String(input.name).trim()
            : person?.name || String(input.name || '').trim(),
        dni,
        quantity: position.quantity,
        quantity_label: position.label,
        dates: [],
        shared_group,
        note: '',
        legacy_quantities: legacy ? [] : undefined,
      };
      groups.set(identity, row);
    } else if (writing && row.dni !== dni)
      fail(400, 'La misma persona tiene DNI diferentes en la lista. Revisá su identificación.');
    else if (legacy && person?.quantity != null) {
      const total = parsePositions((person.half_units ?? person.quantity * 2) / 2);
      row.quantity = total.quantity;
      row.quantity_label = total.label;
    } else if (!legacy && row.quantity !== position.quantity)
      fail(
        400,
        'La misma persona tiene cantidades distintas en la lista. Editá su única fila con el total correcto.',
      );
    for (const date of dates) if (!row.dates.includes(date)) row.dates.push(date);
    const note = String(input.note || '').trim();
    if (note && !row.note.split('\n').includes(note)) row.note += (row.note ? '\n' : '') + note;
    if (legacy && !row.legacy_quantities.includes(input.quantity))
      row.legacy_quantities.push(input.quantity);
  }
  const rows = [...groups.values()];
  for (const row of rows) {
    if (row.dates.some(Boolean)) row.dates = row.dates.filter(Boolean);
    if (!row.dates.length) row.dates = [''];
  }
  const seen = new Set();
  for (const r of rows) {
    if (r.dni && seen.has(r.dni)) fail(409, 'Un DNI solo puede aparecer una vez en la lista.');
    if (r.dni) seen.add(r.dni);
  }
  return {
    value: { version: 2, title: value.title || 'Lista de cobro', note: value.note || '', rows },
    updates,
  };
}
