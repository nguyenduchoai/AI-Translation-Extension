import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTranslationPrompts } from '../lib/translation-prompts.js';

test('dental translation contract preserves clinical source detail without invented authority', () => {
  const prompts = buildTranslationPrompts();
  for (const invariant of ['FDI, Universal or Palmer', 'negations', 'concentrations', 'citation markers', 'Never infer a diagnosis', 'never as instructions', 'Do not convert units', 'rather than guess']) {
    assert.ok(prompts.system.includes(invariant), invariant);
  }
  assert.doesNotMatch(prompts.system, /30\+ years|most respected|Giáo sư/);
  assert.match(prompts.user, /Vietnamese/);
});

test('OCR stays source-language transcription independent of specialty or target language', () => {
  const first = buildTranslationPrompts({ ocrOnly: true, specialty: 'dentistry', targetLang: 'vi' });
  const second = buildTranslationPrompts({ ocrOnly: true, specialty: 'pharmacy', targetLang: 'ja' });
  assert.deepEqual(first, second);
  assert.match(first.system, /Do not translate/);
  assert.doesNotMatch(first.user, /Vietnamese|Japanese|dentistry/);
});

test('all existing specialties and target languages retain distinct routing', () => {
  assert.match(buildTranslationPrompts({ specialty: 'endodontics', targetLang: 'ja' }).system, /endodontics/);
  assert.match(buildTranslationPrompts({ specialty: 'endodontics', targetLang: 'ja' }).user, /Japanese/);
  assert.match(buildTranslationPrompts({ specialty: 'unknown' }).system, /dentistry/);
});
