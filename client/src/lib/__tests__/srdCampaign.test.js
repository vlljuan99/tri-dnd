import test from 'node:test';
import assert from 'node:assert/strict';
import { srdCampaignPath } from '../srdCampaign.js';

test('añade el contexto de campaña a listados y detalles del compendio', () => {
  assert.equal(srdCampaignPath('classes', 7), '/srd/classes?campaignId=7');
  assert.equal(srdCampaignPath('races', 7, 'custom:12'), '/srd/races/custom%3A12?campaignId=7');
});

test('sin campaña conserva el compendio personal normal', () => {
  assert.equal(srdCampaignPath('classes'), '/srd/classes');
  assert.equal(srdCampaignPath('races', null, 'elf'), '/srd/races/elf');
});
