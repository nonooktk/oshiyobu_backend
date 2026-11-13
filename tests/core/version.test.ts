import { describe, expect, it } from 'vitest';
import { CORE_VERSION } from '../../src/core';

describe('core の版', () => {
  it('「数字.数字.数字」の形になっている', () => {
    expect(CORE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
