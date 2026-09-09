// banking_api_ui/src/hooks/__tests__/useAppFlags.spinner.test.jsx
/**
 * The spinner knobs arrive from configStore as STRINGS ('88', 'false') but
 * straight off the config page's own save as real numbers and booleans, so the
 * mapping has to survive both. The accent additionally carries a 'default'
 * sentinel: routes/adminConfig.js reads an empty string as "leave unchanged"
 * and skips the write, so '' could set an accent but never clear one.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { useAppFlags } from '../useAppFlags';

const loadPublicConfig = vi.fn();
vi.mock('../../services/configService', () => ({
  loadPublicConfig: () => loadPublicConfig(),
}));

function Probe() {
  const { appFlags } = useAppFlags();
  return (
    <pre data-testid="flags">
      {JSON.stringify({
        variant: appFlags.spinnerVariant,
        size: appFlags.spinnerSize,
        accent: appFlags.spinnerAccent,
        dark: appFlags.spinnerDarkCard,
        feed: appFlags.spinnerActivityFeed,
      })}
    </pre>
  );
}

const flagsFor = async (cfg) => {
  loadPublicConfig.mockResolvedValue(cfg);
  render(<Probe />);
  await waitFor(() =>
    expect(JSON.parse(screen.getByTestId('flags').textContent).variant).toBeDefined(),
  );
  return JSON.parse(screen.getByTestId('flags').textContent);
};

describe('useAppFlags — spinner knobs', () => {
  it('an empty config yields the pre-knob look', async () => {
    expect(await flagsFor({})).toEqual({
      variant: 'neural',
      size: 88,
      accent: '',
      dark: true,
      feed: true,
    });
  });

  it('reads configStore string values, not just booleans', async () => {
    expect(
      await flagsFor({
        spinner_variant: 'classic',
        spinner_size: '120',
        spinner_dark_card: 'false',
        spinner_activity_feed: 'false',
      }),
    ).toMatchObject({ variant: 'classic', size: 120, dark: false, feed: false });
  });

  it('reads real booleans from the config page save just the same', async () => {
    expect(
      await flagsFor({ spinner_dark_card: false, spinner_activity_feed: false }),
    ).toMatchObject({ dark: false, feed: false });
  });

  it('passes a chosen accent through', async () => {
    expect(await flagsFor({ spinner_accent: '#059669' })).toMatchObject({
      accent: '#059669',
    });
  });

  // The bug this guards: with '' as the sentinel the accent was unclearable,
  // because the POST skips empty strings and the stored colour survived.
  it("treats the 'default' sentinel as no override, so an accent can be cleared", async () => {
    expect(await flagsFor({ spinner_accent: 'default' })).toMatchObject({ accent: '' });
  });

  it('a bad size falls back rather than rendering a 0px spinner', async () => {
    expect(await flagsFor({ spinner_size: 'not-a-number' })).toMatchObject({ size: 88 });
  });
});
