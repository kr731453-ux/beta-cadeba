import { $, esc, dateLabel, message, safe, request } from './shared.js';
import { parsePositions, positionLabel, dniText } from './positions.js';
const drafts = new Map();
let active = null,
  rowTarget = null,
  pdfLoader = null,
  notesFilter = 'all';
let editorDrafts = new Map(),
  editorBaselines = new Map();
const normalizeDni = (value) => {
  const dni = String(value || '')
    .trim()
    .replace(/[.\s]/g, '');
  if (!/^[1-9]\d{5,8}$/.test(dni)) throw Error('Ingresá el DNI con entre 6 y 9 dígitos.');
  return dni;
};
const nameKey = (name) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-AR');
export const notesTemplate = () =>
  '<div class="card" id="notesPanel"><h3>Notas · Personas y puestos solicitados</h3><p class="hint">Cada persona aparece una sola vez con su DNI, cantidad total y fechas. Los compartidos se reúnen en una fila, conservando la cantidad de cada integrante. Esta lista manual se guarda en las notas de la cadena.</p><div id="notesBody"><p class="muted">Cargando notas…</p></div></div>';
function markDirty() {
  active.dirty = true;
  if ($('notesState')) $('notesState').textContent = 'Cambios sin guardar';
}
function displayRows(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.shared_group || r.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.values()];
}
const uniqueDates = (people) => [...new Set(people.flatMap((r) => r.dates || ['']))];
const quantityText = (r) => positionLabel(r.quantity, r.quantity_label);
const peopleNames = (group) =>
  new Intl.ListFormat('es-AR', { type: 'conjunction' }).format(group.map((r) => r.name));
function render() {
  if (!$('notesBody') || !active) return;
  const { data, chain } = active,
    readOnly = !!chain.archived_at,
    allGroups = displayRows(data.rows),
    groups = allGroups.filter((g) => notesFilter === 'all' || g.length > 1);
  $('notesBody').innerHTML =
    `<div class="formgrid"><label>Título de la lista<input id="notesTitle" maxlength="80" value="${esc(data.title)}" ${readOnly ? 'readonly' : ''}></label><label>Nota general<textarea id="notesGeneral" rows="3" maxlength="3000" ${readOnly ? 'readonly' : ''}>${esc(data.note)}</textarea></label></div><div class="chainviews"><button data-notes-filter="all" aria-pressed="${notesFilter === 'all'}" class="${notesFilter === 'all' ? 'active' : ''}">Todas las personas</button><button data-notes-filter="shared" aria-pressed="${notesFilter === 'shared'}" class="${notesFilter === 'shared' ? 'active' : ''}">Compartidos</button></div><div class="actions notesactions">${!readOnly ? '<button class="primary" id="addNoteRow">Agregar persona</button><button id="createNoteShared">Crear compartido</button><button id="copyNotePeople">Copiar participantes de la cadena</button><button id="saveNotes">Guardar notas</button>' : ''}<button id="downloadNotes" ${groups.length ? '' : 'disabled'}>${notesFilter === 'shared' ? 'Descargar compartidos en PDF' : 'Descargar PDF'}</button><button id="refreshNotes">Recargar lista</button></div><p id="notesState" class="hint" role="status">${active.dirty ? 'Cambios sin guardar' : data.updated ? 'Notas guardadas · ' + new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(data.updated)) : 'Todavía no hay notas guardadas.'}</p><p class="hint">${data.rows.length} ${data.rows.length === 1 ? 'persona' : 'personas'} · ${allGroups.length} ${allGroups.length === 1 ? 'fila' : 'filas'}. En los compartidos, los DNI y las cantidades siguen el mismo orden que los nombres.</p>${
      groups.length
        ? `<div class="tablewrap"><table class="notestable"><thead><tr><th>N.º</th><th>Persona o compartidos</th><th>DNI</th><th>Puestos de cada integrante</th><th>Fechas de cobro</th><th>Observaciones</th>${!readOnly ? '<th>Acciones</th>' : ''}</tr></thead><tbody>${groups
            .map(
              (group, i) =>
                `<tr><td>${i + 1}</td><td><strong>${esc(peopleNames(group))}</strong>${group.length > 1 ? '<small class="pill">Compartido</small>' : ''}</td><td data-label="DNI">${group.map((r) => esc(dniText(r.dni))).join(' · ')}</td><td data-label="Puestos de cada integrante">${group.map((r) => esc(quantityText(r))).join(' · ')}</td><td data-label="Fechas de cobro">${uniqueDates(
                  group,
                )
                  .map((d) => (d ? dateLabel(d) : 'Fecha pendiente'))
                  .map(esc)
                  .join(
                    '<br>',
                  )}</td><td class="notestext" data-label="Observaciones">${[...new Set(group.map((r) => r.note).filter(Boolean))].map(esc).join('\n') || '—'}</td>${!readOnly ? `<td class="notesrowactions"><div class="actions"><button data-note-edit="${group[0].id}">${group.length > 1 ? 'Editar fila' : 'Editar'}</button><button data-note-remove="${group[0].id}">Quitar fila</button><button data-note-up="${group[0].id}" aria-label="Subir fila ${i + 1}" ${i === 0 ? 'disabled' : ''}>↑</button><button data-note-down="${group[0].id}" aria-label="Bajar fila ${i + 1}" ${i === groups.length - 1 ? 'disabled' : ''}>↓</button></div></td>` : ''}</tr>`,
            )
            .join('')}</tbody></table></div>`
        : `<div class="empty"><h3>${notesFilter === 'shared' ? 'Puestos compartidos' : 'Armá tu lista de personas'}</h3><p>${notesFilter === 'shared' ? 'Usá «Crear compartido» y elegí a los integrantes, o agregalos con su DNI y cantidad.' : 'Agregá nombre, DNI, cantidad solicitada y fechas. Para compartir una fila, elegí a los compañeros al editar la persona.'}</p></div>`
    }`;
  $('notesTitle').oninput = () => {
    data.title = $('notesTitle').value;
    markDirty();
  };
  $('notesGeneral').oninput = () => {
    data.note = $('notesGeneral').value;
    markDirty();
  };
  document.querySelectorAll('[data-notes-filter]').forEach(
    (b) =>
      (b.onclick = () => {
        notesFilter = b.dataset.notesFilter;
        render();
      }),
  );
  if (!readOnly) {
    $('addNoteRow').onclick = () => editRow();
    $('createNoteShared').onclick = () => {
      if (active.data.rows.length < 2) {
        editRow();
        message(
          'Agregá a cada integrante con su DNI y cantidad. Después elegí con quién comparte la fila.',
        );
        return;
      }
      editRow(active.data.rows[0].id);
      $('noteSharedChoices').scrollIntoView({ block: 'nearest' });
    };
    $('copyNotePeople').onclick = copyPeople;
    $('saveNotes').onclick = safe(async () => {
      await save(active);
      message('Notas guardadas.');
    });
  }
  $('refreshNotes').onclick = safe(async () => {
    if (active.dirty && !confirm('¿Recargar y descartar los cambios sin guardar?')) return;
    active.data = await request('/api/admin/chains/' + active.chain.id + '/notes');
    active.dirty = false;
    render();
  });
  $('downloadNotes').onclick = safe(async () => {
    const current = active,
      button = $('downloadNotes'),
      sharedOnly = notesFilter === 'shared';
    button.disabled = true;
    try {
      const saved = current.dirty ? await save(current) : current.data,
        exported = { chain: current.chain, data: structuredClone(saved), sharedOnly };
      await loadPdf();
      const blob = await new Promise((resolve) =>
          window.pdfMake.createPdf(pdfDefinition(exported)).getBlob(resolve),
        ),
        url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download =
        'Ronda-' +
        current.chain.name
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-zA-Z0-9_-]+/g, '-')
          .slice(0, 60) +
        (sharedOnly ? '-compartidos' : '-lista') +
        '.pdf';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      message('PDF descargado con personas, DNI y cantidades respetadas.');
    } finally {
      button.disabled = false;
    }
  });
}
async function save(current) {
  if (current.savePromise) return current.savePromise;
  if (!current.data.title.trim()) throw Error('Escribí un título.');
  if (active === current) {
    if ($('saveNotes')) $('saveNotes').disabled = true;
    $('refreshNotes').disabled = true;
    $('notesState').textContent = 'Guardando notas…';
  }
  const operation = (async () => {
    const snapshot = JSON.stringify(current.data),
      next = await request('/api/admin/chains/' + current.chain.id + '/notes', {
        method: 'POST',
        body: JSON.parse(snapshot),
      });
    if (current.data.revision > next.revision) return next;
    if (JSON.stringify(current.data) === snapshot) {
      current.data = next;
      current.dirty = false;
    } else {
      current.data.revision = next.revision;
      current.data.updated = next.updated;
      current.dirty = true;
    }
    return next;
  })();
  current.savePromise = operation;
  try {
    return await operation;
  } finally {
    current.savePromise = null;
    if (active === current) render();
  }
}
function showDateInputs(dates) {
  $('noteDates').innerHTML = (dates.length ? dates : [''])
    .map(
      (date) =>
        `<div class="notedateinput"><input class="noteDateInput" type="date" value="${esc(date)}" aria-label="Fecha de cobro"><button type="button" data-remove-date>Quitar fecha</button></div>`,
    )
    .join('');
}
function captureEditor() {
  return {
    id: rowTarget,
    user: $('notePerson').value,
    name: $('noteName').value,
    dni: $('noteDni').value,
    quantity: $('noteQuantity').value,
    note: $('noteObservation').value,
    dates: [...document.querySelectorAll('.noteDateInput')].map((i) => i.value),
    mates: [...document.querySelectorAll('#noteSharedChoices input:checked')].map((i) => i.value),
  };
}
function stashEditor() {
  if (!rowTarget) return;
  const fields = captureEditor();
  if (JSON.stringify(fields) !== editorBaselines.get(rowTarget))
    editorDrafts.set(rowTarget, fields);
  else editorDrafts.delete(rowTarget);
}
function populateEditor(r) {
  rowTarget = r?.id || null;
  $('notePerson').value = r?.user_id || '';
  $('noteName').value = r?.name || '';
  $('noteDni').value = r?.dni || '';
  $('noteQuantity').value = r ? quantityText(r) : '1';
  $('noteObservation').value = r?.note || '';
  showDateInputs(r?.dates || ['']);
  $('noteSharedChoices').innerHTML =
    active.data.rows
      .filter((p) => p.id !== rowTarget)
      .map(
        (p) =>
          `<label class="sharedchoice"><input type="checkbox" value="${p.id}" ${r?.shared_group && r.shared_group === p.shared_group ? 'checked' : ''}><span>${esc(p.name)} · ${esc(dniText(p.dni))}</span></label>`,
      )
      .join('') ||
    '<p class="hint">Primero agregá a las otras personas para poder compartir una fila.</p>';
  if (r) {
    if (!editorBaselines.has(r.id)) editorBaselines.set(r.id, JSON.stringify(captureEditor()));
    const draft = editorDrafts.get(r.id);
    if (draft) {
      $('notePerson').value = draft.user;
      $('noteName').value = draft.name;
      $('noteDni').value = draft.dni;
      $('noteQuantity').value = draft.quantity;
      $('noteObservation').value = draft.note;
      showDateInputs(draft.dates);
      document
        .querySelectorAll('#noteSharedChoices input')
        .forEach((i) => (i.checked = draft.mates.includes(i.value)));
    }
  }
}
function editRow(id = null) {
  editorDrafts = new Map();
  editorBaselines = new Map();
  const r = active.data.rows.find((r) => r.id === id),
    group = r?.shared_group
      ? active.data.rows.filter((p) => p.shared_group === r.shared_group)
      : [];
  $('noteRowHeading').textContent =
    group.length > 1
      ? 'Editar fila compartida'
      : id
        ? 'Editar persona en notas'
        : 'Agregar persona a notas';
  $('noteEditPersonLabel').hidden = group.length < 2;
  $('noteEditPerson').innerHTML = group
    .map((p) => `<option value="${p.id}">${esc(p.name)} · ${esc(dniText(p.dni))}</option>`)
    .join('');
  $('notePerson').innerHTML =
    '<option value="">Nombre y DNI manual</option>' +
    active.detail.members
      .filter((p) => p.state === 'active')
      .map((p) => `<option value="${p.user_id}">${esc(p.name)} · ${esc(dniText(p.dni))}</option>`)
      .join('');
  populateEditor(r);
  if (id) $('noteEditPerson').value = id;
  $('saveNoteRow').textContent =
    group.length > 1 ? 'Guardar cambios de la fila' : 'Guardar persona en la lista';
  $('noteRowDialog').showModal();
  $('noteName').focus();
}
function regroup(id, mates) {
  const target = active.data.rows.find((r) => r.id === id),
    old = target.shared_group;
  target.shared_group = null;
  if (old) {
    const remaining = active.data.rows.filter((r) => r.shared_group === old);
    if (remaining.length < 2) remaining.forEach((r) => (r.shared_group = null));
  }
  const joined = new Set([id]);
  for (const mateId of mates) {
    const mate = active.data.rows.find((r) => r.id === mateId);
    if (!mate || mate.id === id) continue;
    joined.add(mate.id);
    if (mate.shared_group)
      active.data.rows
        .filter((r) => r.shared_group === mate.shared_group)
        .forEach((r) => joined.add(r.id));
  }
  if (joined.size > 1) {
    const group = 'share_' + crypto.randomUUID();
    active.data.rows.filter((r) => joined.has(r.id)).forEach((r) => (r.shared_group = group));
  }
}
function copyPeople() {
  const detail = active.detail;
  for (const m of detail.members.filter((m) => m.state === 'active')) {
    const dates = detail.turns
        .filter((t) => (t.participants || [t]).some((p) => p.user_id === m.user_id))
        .map((t) => t.date),
      existing = active.data.rows.find(
        (r) =>
          r.user_id === m.user_id ||
          (m.dni && r.dni === m.dni) ||
          (!r.user_id && !r.dni && nameKey(r.name) === nameKey(m.name)),
      );
    if (existing) {
      existing.user_id = m.user_id;
      existing.dni = m.dni || existing.dni;
      existing.dates = [...new Set([...existing.dates, ...dates])].filter(Boolean);
      if (!existing.dates.length) existing.dates = [''];
    } else {
      if (active.data.rows.length >= 500) {
        message('La lista admite hasta 500 personas.', true);
        return;
      }
      const quantity = (m.half_units ?? m.quantity * 2) / 2;
      active.data.rows.push({
        id: crypto.randomUUID(),
        user_id: m.user_id,
        name: m.name,
        dni: m.dni || null,
        quantity,
        quantity_label: positionLabel(quantity),
        dates: dates.length ? dates : [''],
        shared_group: null,
        note: '',
      });
    }
  }
  for (const turn of detail.turns) {
    const parts = turn.participants || [turn];
    if (parts.length > 1) {
      const ids = parts
        .map((p) => active.data.rows.find((r) => r.user_id === p.user_id)?.id)
        .filter(Boolean);
      if (ids.length > 1) regroup(ids[0], ids.slice(1));
    }
  }
  markDirty();
  render();
}
export async function mountNotes(detail) {
  const id = detail.chain.id;
  if (active?.chain.id !== id) notesFilter = 'all';
  const element = $('notesBody');
  try {
    let current = drafts.get(id);
    if (!current?.dirty || detail.chain.archived_at) {
      current = {
        chain: detail.chain,
        detail,
        data: await request('/api/admin/chains/' + id + '/notes'),
        dirty: false,
      };
      drafts.set(id, current);
    }
    current.chain = detail.chain;
    current.detail = detail;
    if ($('notesBody') !== element) return;
    active = current;
    render();
  } catch (e) {
    if ($('notesBody') === element) {
      element.innerHTML =
        '<p class="muted">No se pudieron cargar las notas. Volvé a abrir este apartado.</p>';
      message(e.message, true);
    }
  }
}
export function initNotes() {
  $('closeNoteRow').onclick = () => $('noteRowDialog').close();
  $('addNoteDate').onclick = () =>
    showDateInputs([...document.querySelectorAll('.noteDateInput')].map((i) => i.value).concat(''));
  $('noteDates').onclick = (e) => {
    if (e.target.closest('[data-remove-date]')) {
      e.target.closest('.notedateinput').remove();
      if (!document.querySelector('.noteDateInput')) showDateInputs(['']);
    }
  };
  $('noteEditPerson').onchange = () => {
    stashEditor();
    populateEditor(active.data.rows.find((r) => r.id === $('noteEditPerson').value));
  };
  $('notePerson').onchange = () => {
    const person = active.detail.members.find((m) => m.user_id === $('notePerson').value);
    if (person) {
      $('noteName').value = person.name;
      $('noteDni').value = person.dni || '';
      $('noteQuantity').value = positionLabel((person.half_units ?? person.quantity * 2) / 2);
      showDateInputs(
        active.detail.turns
          .filter((t) => (t.participants || [t]).some((p) => p.user_id === person.user_id))
          .map((t) => t.date),
      );
    }
  };
  $('noteRowForm').onsubmit = safe(async (e) => {
    e.preventDefault();
    if (active.chain.archived_at) throw Error('Restaurá la cadena para modificar sus notas.');
    stashEditor();
    const fields = editorDrafts.size ? [...editorDrafts.values()] : [captureEditor()];
    const prepared = fields.map((raw) => {
      try {
        const dni = normalizeDni(raw.dni),
          position = parsePositions(raw.quantity),
          name = raw.name.trim();
        if (!name) throw Error('Escribí el nombre.');
        const person = active.detail.members.find((m) => m.user_id === raw.user),
          existing =
            active.data.rows.find((r) => r.id === raw.id) ||
            active.data.rows.find((r) => r.dni === dni || (person && r.user_id === person.user_id)),
          dates = [...new Set(raw.dates)],
          row = {
            id: existing?.id || crypto.randomUUID(),
            user_id: person?.user_id || existing?.user_id || null,
            name,
            dni,
            quantity: position.quantity,
            quantity_label: position.label,
            dates: !raw.id && existing ? [...new Set([...existing.dates, ...dates])] : dates,
            shared_group: existing?.shared_group || null,
            note: !raw.id && existing && !raw.note.trim() ? existing.note : raw.note.trim(),
            profile_dni_edit: !!(person && person.dni !== dni),
            profile_name_edit: !!(person && person.name !== name),
          };
        if (row.dates.some(Boolean)) row.dates = row.dates.filter(Boolean);
        const baseline =
          raw.id && editorBaselines.has(raw.id) ? JSON.parse(editorBaselines.get(raw.id)) : null;
        return {
          row,
          existing,
          raw,
          matesChanged: !baseline || JSON.stringify(raw.mates) !== JSON.stringify(baseline.mates),
        };
      } catch (error) {
        throw Error((raw.name.trim() || 'Integrante') + ': ' + error.message);
      }
    });
    const original = structuredClone(active.data.rows);
    try {
      for (const item of prepared) {
        const index = active.data.rows.findIndex((r) => r.id === item.row.id);
        if (index >= 0) active.data.rows[index] = item.row;
        else {
          if (active.data.rows.length >= 500) throw Error('La lista admite hasta 500 personas.');
          active.data.rows.push(item.row);
        }
      }
      const dnis = new Set();
      for (const r of active.data.rows) {
        if (r.dni && dnis.has(r.dni))
          throw Error('Un DNI solo puede pertenecer a una persona de la lista.');
        if (r.dni) dnis.add(r.dni);
      }
      for (const item of prepared)
        if (
          item.matesChanged &&
          (item.raw.id || !item.existing || item.raw.mates.length || !item.existing.shared_group)
        )
          regroup(item.row.id, item.raw.mates);
    } catch (error) {
      active.data.rows = original;
      throw error;
    }
    markDirty();
    $('noteRowDialog').close();
    editorDrafts.clear();
    render();
    message(
      prepared.length > 1
        ? 'Cambios de los integrantes conservados en la fila.'
        : prepared[0].existing
          ? 'Persona actualizada en su única fila.'
          : 'Persona agregada a las notas.',
    );
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest(
      '[data-note-edit],[data-note-remove],[data-note-up],[data-note-down]',
    );
    if (!b || b.disabled || !active || active.chain.archived_at) return;
    const id = b.dataset.noteEdit || b.dataset.noteRemove || b.dataset.noteUp || b.dataset.noteDown,
      groups = displayRows(active.data.rows),
      i = groups.findIndex((g) => g.some((r) => r.id === id));
    if (i < 0) return;
    if (b.dataset.noteEdit) {
      editRow(id);
      return;
    }
    if (b.dataset.noteRemove) {
      const remove = new Set(groups[i].map((r) => r.id));
      active.data.rows = active.data.rows.filter((r) => !remove.has(r.id));
    } else {
      const direction = b.dataset.noteUp ? -1 : 1,
        visible = groups
          .map((g, index) => ({ g, index }))
          .filter((x) => notesFilter === 'all' || x.g.length > 1),
        visibleIndex = visible.findIndex((x) => x.index === i),
        target = visible[visibleIndex + direction];
      if (!target) return;
      const j = target.index;
      [groups[i], groups[j]] = [groups[j], groups[i]];
      active.data.rows = groups.flat();
    }
    markDirty();
    render();
  });
  window.addEventListener('beforeunload', (e) => {
    if ([...drafts.values()].some((d) => d.dirty)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}
async function loadPdf() {
  if (window.pdfMake?.vfs) return;
  if (!pdfLoader)
    pdfLoader = (async () => {
      for (const src of ['/vendor/pdfmake-0.2.20.min.js', '/vendor/pdfmake-fonts-0.2.20.js'])
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = src;
          s.onload = resolve;
          s.onerror = () => reject(Error('No se pudo preparar el PDF. Intentá nuevamente.'));
          document.head.appendChild(s);
        });
    })().catch((e) => {
      pdfLoader = null;
      throw e;
    });
  await pdfLoader;
}
export function pdfDefinition(current) {
  const { data, chain } = current,
    groups = displayRows(data.rows).filter((g) => !current.sharedOnly || g.length > 1),
    stamp = new Intl.DateTimeFormat('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date()),
    head = [
      'N.º',
      'Personas',
      'DNI (mismo orden)',
      'Puestos (mismo orden)',
      'Fechas de cobro',
      'Observaciones',
    ].map((text) => ({ text, bold: true, color: '#ffffff', fillColor: '#173f36' }));
  return {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [30, 45, 30, 40],
    info: {
      title: data.title + ' · ' + chain.name,
      author: 'Ronda',
      subject: 'Lista de personas, DNI y puestos solicitados',
    },
    header: {
      text: 'RONDA · NOTAS DE LA CADENA',
      fontSize: 9,
      color: '#617567',
      margin: [30, 20, 30, 0],
    },
    footer: (page, pages) => ({
      columns: [
        { text: 'Lista manual · Exportada el ' + stamp },
        { text: 'Página ' + page + ' de ' + pages, alignment: 'right' },
      ],
      fontSize: 8,
      color: '#617567',
      margin: [30, 12, 30, 0],
    }),
    content: [
      { text: data.title, fontSize: 23, bold: true, color: '#173f36', margin: [0, 0, 0, 8] },
      { text: chain.name, fontSize: 12, bold: true, color: '#526b5c', margin: [0, 0, 0, 10] },
      {
        text:
          groups.reduce((n, g) => n + g.length, 0) +
          ' personas · ' +
          groups.length +
          (groups.length === 1 ? ' fila. En los compartidos' : ' filas. En los compartidos') +
          ', los DNI y las cantidades corresponden al orden de los nombres.',
        fontSize: 9,
        color: '#617567',
        margin: [0, 0, 0, 14],
      },
      ...(data.note ? [{ text: data.note, fontSize: 10, margin: [0, 0, 0, 14] }] : []),
      {
        table: {
          headerRows: 1,
          dontBreakRows: false,
          widths: [22, 135, 110, 105, 85, '*'],
          body: [
            head,
            ...groups.map((g, i) => [
              String(i + 1),
              peopleNames(g) + (g.length > 1 ? '\nCompartido' : ''),
              g.map((r) => dniText(r.dni)).join(' · '),
              g.map(quantityText).join(' · '),
              uniqueDates(g)
                .map((d) => (d ? d.split('-').reverse().join('/') : 'Fecha pendiente'))
                .join('\n'),
              [...new Set(g.map((r) => r.note).filter(Boolean))].join('\n') || '—',
            ]),
          ],
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0,
          hLineColor: () => '#dce5df',
          fillColor: (row) => (row > 0 && row % 2 === 0 ? '#f1f5ef' : null),
          paddingLeft: () => 7,
          paddingRight: () => 7,
          paddingTop: () => 8,
          paddingBottom: () => 8,
        },
      },
    ],
    defaultStyle: { font: 'Roboto', fontSize: 9, lineHeight: 1.2, color: '#263d32' },
  };
}
