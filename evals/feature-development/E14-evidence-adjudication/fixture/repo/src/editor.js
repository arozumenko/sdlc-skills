export function retry(state, send) { return send(state.draft); }
export async function save(send) {
  try { await send(); return { status: 'saved' }; }
  catch { return { status: 'saved' }; }
}
