// Notes persistence: save to the device store, restore on launch.
export function save(store, notes) {
  store.set("notes.v2", JSON.stringify(notes));
}

export function restore(store) {
  const raw = store.get("notes");
  return raw ? JSON.parse(raw) : [];
}
