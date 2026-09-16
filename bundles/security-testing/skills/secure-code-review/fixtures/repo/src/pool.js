// Minimal query surface so the fixture reads like a real module.
export const pool = {
  async query(sql, params = []) {
    return { sql, params, rows: [] };
  },
};
export const accounts = {
  async remove(id) {
    return { removed: id };
  },
};
