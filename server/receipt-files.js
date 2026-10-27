export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024;
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};

// Count actual bytes, including chunked requests, before invoking the native parser.
export async function receiptForm(request) {
  const type = request.headers.get('Content-Type') || '';
  if (!/^multipart\/form-data\s*;/i.test(type) || !/boundary=/i.test(type))
    fail(415, 'Enviá el comprobante como formulario con archivo adjunto.');
  if (Number(request.headers.get('Content-Length')) > MAX_BODY_BYTES)
    fail(413, 'El comprobante supera los 10 MB.');
  if (!request.body) fail(400, 'Falta el archivo adjunto.');
  const reader = request.body.getReader();
  let total = 0;
  const bounded = new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
          await reader.cancel().catch(() => {});
          fail(413, 'El comprobante supera los 10 MB.');
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  try {
    const form = await new Response(bounded, { headers: { 'Content-Type': type } }).formData();
    if (form.getAll('file').length !== 1) fail(400, 'Adjuntá un solo comprobante.');
    return form;
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (total > MAX_BODY_BYTES) fail(413, 'El comprobante supera los 10 MB.');
    if (error.status) throw error;
    fail(
      400,
      'La carga llegó incompleta o el formulario no es válido. Volvé a seleccionar el archivo.',
    );
  }
}

export function fileType(bytes) {
  const starts = (sig) => sig.every((b, i) => bytes[i] === b);
  if (starts([37, 80, 68, 70, 45])) return ['application/pdf', 'pdf'];
  if (starts([137, 80, 78, 71, 13, 10, 26, 10])) return ['image/png', 'png'];
  if (starts([255, 216, 255])) return ['image/jpeg', 'jpg'];
  if (
    new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  )
    return ['image/webp', 'webp'];
  fail(415, 'El contenido no corresponde a un PDF, JPG, PNG o WebP válido.');
}

export async function validateReceipt(file) {
  if (!(file instanceof File) || !file.size) fail(400, 'Elegí un comprobante.');
  if (file.size > MAX_FILE_BYTES) fail(413, 'El comprobante supera los 10 MB.');
  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    fail(400, 'No se pudo leer el comprobante. Volvé a seleccionarlo.');
  }
  const [mime, extension] = fileType(new Uint8Array(buffer));
  const base = file.name
    .split(/[\\/]/)
    .pop()
    .normalize('NFKC')
    .replace(/\.[^.]*$/, '')
    .replace(/[^\p{L}\p{N} _-]/gu, '_')
    .slice(0, 100)
    .trim();
  return { buffer, mime, filename: `${base || 'comprobante'}.${extension}` };
}

export async function storeReceipt(bucket, key, file) {
  try {
    await bucket.put(key, file.buffer, { httpMetadata: { contentType: file.mime } });
  } catch {
    fail(503, 'No se pudo guardar el archivo. El pago no fue registrado. Intentá nuevamente.');
  }
}

export async function discardReceipt(bucket, key) {
  try {
    await bucket.delete(key);
  } catch {
    console.error('Receipt cleanup failed; orphan requires maintenance.');
  }
}
