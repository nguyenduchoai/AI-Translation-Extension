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

test('page input describes supplied text, keeps clinical rules and removes screenshot wording', () => {
  const prompts = buildTranslationPrompts({ inputType: 'page', targetLang: 'en', specialty: 'periodontics' });
  assert.match(prompts.user, /web page text into English/);
  assert.doesNotMatch(prompts.system + prompts.user, /image|visible|radiograph|photograph|cropped/i);
  assert.match(prompts.system, /periodontics/);
  assert.match(prompts.system, /FDI, Universal or Palmer/);
  assert.match(prompts.system, /never as instructions/);
});

test('custom template interpolates known variables while retaining mandatory accuracy rules', () => {
  const prompts = buildTranslationPrompts({ targetLang: 'ja', specialty: 'endodontics', customInstruction: 'Use {{targetLanguage}} for {{specialty}}; keep {{unknown}} literally.' });
  assert.match(prompts.system, /Use Japanese for endodontics/);
  assert.match(prompts.system, /keep {{unknown}} literally/);
  assert.match(prompts.system, /lower priority/);
  assert.match(prompts.system, /Do not convert units/);
  assert.match(prompts.system, /Never change source facts/);
  assert.deepEqual(buildTranslationPrompts({ customInstruction: '  ' }), buildTranslationPrompts());
  assert.throws(() => buildTranslationPrompts({ customInstruction: 'x'.repeat(4001) }), /4000/);
});

test('custom OCR template cannot replace the transcription contract', () => {
  const prompts = buildTranslationPrompts({ ocrOnly: true, customInstruction: 'Keep column order.' });
  assert.match(prompts.system, /Keep column order/);
  assert.match(prompts.system, /Do not translate, correct, interpret/);
  assert.match(prompts.system, /This task remains verbatim transcription/);
  assert.equal(prompts.user, buildTranslationPrompts({ ocrOnly: true }).user);
});
