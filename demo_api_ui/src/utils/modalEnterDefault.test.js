import installModalEnterDefault from './modalEnterDefault';
import { fireEvent } from '@testing-library/react';

describe('installModalEnterDefault', () => {
  let off;
  beforeEach(() => { off = installModalEnterDefault(); });
  afterEach(() => { off(); document.body.innerHTML = ''; });

  const open = (extra = '') => {
    document.body.innerHTML = `<div role="dialog"><input id="i"/>${extra}
      <button class="btn btn-secondary" id="no">Cancel</button>
      <button class="btn btn-primary" id="yes">OK</button></div>`;
    const clicks = [];
    document.getElementById('yes').addEventListener('click', () => clicks.push('yes'));
    document.getElementById('no').addEventListener('click', () => clicks.push('no'));
    return clicks;
  };

  it('clicks the primary button on Enter', () => {
    const clicks = open();
    fireEvent.keyDown(document.getElementById('i'), { key: 'Enter' });
    expect(clicks).toEqual(['yes']);
  });
  it('skips disabled, textarea, and no-dialog cases', () => {
    const clicks = open('<textarea id="t"></textarea>');
    fireEvent.keyDown(document.getElementById('t'), { key: 'Enter' });
    document.getElementById('yes').disabled = true;
    fireEvent.keyDown(document.getElementById('i'), { key: 'Enter' });
    document.querySelector('[role=dialog]').removeAttribute('role');
    document.getElementById('yes').disabled = false;
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(clicks).toEqual([]);
  });
});
