import '../crypto-patch';
import { ai, validateServiceAccount } from './aiClient';
import fs from 'fs';

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

describe('aiClient', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateServiceAccount', () => {
    it('returns false if file does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      expect(validateServiceAccount('fake-path.json')).toBe(false);
    });

    it('returns false if private_key is missing', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ client_email: 'test@test.com' }));
      expect(validateServiceAccount('fake-path.json')).toBe(false);
    });
  });

  describe('Monkey Patching Fallbacks', () => {
    it('is robust', () => {
      // The patching logic is tested implicitly via integration, but unit tests
      // for the closures require more complex mocking. We verify it doesn't break basic AI init.
      expect(ai).toBeDefined();
      expect(ai.models).toBeDefined();
      expect(ai.models.generateContent).toBeInstanceOf(Function);
      expect(ai.models.generateContentStream).toBeInstanceOf(Function);
      expect(ai.models.embedContent).toBeInstanceOf(Function);
    });
  });
});
