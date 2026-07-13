import test from "node:test";
import assert from "node:assert/strict";
import db, { audit, now } from "../backend/db.js";

test("la base contiene las entidades nucleares de SIJ-OL", () => {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name);
  for (const expected of ["expedientes", "tesauro_documentos", "generaciones", "auditoria", "agenda"]) assert.ok(names.includes(expected));
});

test("las correcciones pueden conservar trazabilidad", () => {
  audit("prueba", null, "verificar", { instante: now() });
  const row = db.prepare("SELECT * FROM auditoria WHERE entidad='prueba' ORDER BY id DESC LIMIT 1").get();
  assert.equal(row.accion, "verificar");
  assert.match(row.detalle, /instante/);
});
