const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone } = require('./server');

test('preserva telefone brasileiro com DDI', () => {
  assert.equal(normalizePhone('5519912345678'), '5519912345678');
});

test('adiciona DDI 55 a número nacional', () => {
  assert.equal(normalizePhone('(19) 91234-5678'), '5519912345678');
});

test('rejeita telefone curto ou vazio', () => {
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone(''), null);
});

test('rejeita telefone acima do tamanho internacional esperado', () => {
  assert.equal(normalizePhone('1234567890123456'), null);
});
