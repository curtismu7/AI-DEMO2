// banking_api_ui/src/utils/__tests__/educationalPages.test.js
import { isEducationalPath } from '../educationalPages';

describe('isEducationalPath', () => {
  describe('matches educational routes', () => {
    it('matches /sequence-diagram exactly', () => {
      expect(isEducationalPath('/sequence-diagram')).toBe(true);
    });

    it('matches /architecture exactly', () => {
      expect(isEducationalPath('/architecture')).toBe(true);
    });

    it('matches /architecture/system (subpath)', () => {
      expect(isEducationalPath('/architecture/system')).toBe(true);
    });

    it('matches /architecture/flow (subpath)', () => {
      expect(isEducationalPath('/architecture/flow')).toBe(true);
    });

    it('matches /architecture/token-flow (subpath)', () => {
      expect(isEducationalPath('/architecture/token-flow')).toBe(true);
    });

    it('matches /architecture/overview (subpath)', () => {
      expect(isEducationalPath('/architecture/overview')).toBe(true);
    });
  });

  describe('does not match operational routes', () => {
    it('does not match /', () => {
      expect(isEducationalPath('/')).toBe(false);
    });

    it('does not match /dashboard', () => {
      expect(isEducationalPath('/dashboard')).toBe(false);
    });

    it('does not match /admin', () => {
      expect(isEducationalPath('/admin')).toBe(false);
    });

    it('does not match /monitoring/token-chain', () => {
      expect(isEducationalPath('/monitoring/token-chain')).toBe(false);
    });

    it('does not match /agent', () => {
      expect(isEducationalPath('/agent')).toBe(false);
    });

    it('does not match /setup', () => {
      expect(isEducationalPath('/setup')).toBe(false);
    });

    it('does not match paths that contain "architecture" as a substring but not a prefix', () => {
      // Guard against accidental false-positives — only path-prefix matches count.
      expect(isEducationalPath('/dashboard-architecture')).toBe(false);
      expect(isEducationalPath('/foo/architecture')).toBe(false);
    });

    it('does not match paths that contain "sequence-diagram" as a substring but not a prefix', () => {
      expect(isEducationalPath('/foo/sequence-diagram')).toBe(false);
    });
  });

  describe('defaults to window.location.pathname when no argument is given', () => {
    // Spy on window.location.pathname so each test gets full control without
    // JSDOM descriptor conflicts.
    let locationSpy;

    beforeEach(() => {
      locationSpy = jest.spyOn(window, 'location', 'get');
    });

    afterEach(() => {
      locationSpy.mockRestore();
    });

    function setPath(pathname) {
      locationSpy.mockReturnValue({ pathname });
    }

    it('returns true when window pathname is educational', () => {
      setPath('/sequence-diagram');
      expect(isEducationalPath()).toBe(true);
    });

    it('returns false when window pathname is operational', () => {
      setPath('/dashboard');
      expect(isEducationalPath()).toBe(false);
    });
  });
});
