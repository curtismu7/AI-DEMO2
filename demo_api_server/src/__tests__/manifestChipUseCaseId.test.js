'use strict';

const fs = require('fs');
const path = require('path');
const { isValidUseCaseId } = require('../../config/useCases');

const VERTICALS_DIR = path.join(__dirname, '../../config/verticals');
const VERTICALS = ['banking', 'healthcare', 'retail', 'government', 'university', 'workforce', 'sporting-goods', 'manufacturing'];

describe('vertical manifest chips carry a valid useCaseId', () => {
  for (const vertical of VERTICALS) {
    const manifestPath = path.join(VERTICALS_DIR, vertical, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const chips = (manifest.dashboard && manifest.dashboard.chips10) || [];
    const bothChips = chips.filter((c) => c.mode === 'both');

    test(`${vertical}: has at least one 'both' chip`, () => {
      expect(bothChips.length).toBeGreaterThan(0);
    });

    for (const chip of bothChips) {
      test(`${vertical}/${chip.id} ("${chip.label}") declares a valid useCaseId`, () => {
        expect(typeof chip.useCaseId).toBe('string');
        expect(chip.useCaseId.length).toBeGreaterThan(0);
        expect(isValidUseCaseId(chip.useCaseId)).toBe(true);
      });
    }
  }
});
