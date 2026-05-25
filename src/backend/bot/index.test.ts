import { setupBot } from './index';

jest.mock('telegraf', () => {
  return {
    Telegraf: jest.fn().mockImplementation(() => {
      return {
        start: jest.fn(),
        command: jest.fn(),
        on: jest.fn(),
        action: jest.fn(),
        catch: jest.fn(),
        launch: jest.fn().mockResolvedValue(true),
        telegram: {
          deleteWebhook: jest.fn().mockResolvedValue(true)
        }
      };
    }),
    Markup: {
      inlineKeyboard: jest.fn(),
      button: { callback: jest.fn() }
    }
  };
});

jest.mock('uuid', () => ({ v4: () => '123' }));
jest.mock('sharp', () => jest.fn());
jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn().mockImplementation(() => ({
    bucket: jest.fn()
  }))
}));


describe('Bot Setup', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns null if TELEGRAM_BOT_TOKEN is missing', () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const bot = setupBot();
    expect(bot).toBeNull();
  });

  it('returns a bot instance if TELEGRAM_BOT_TOKEN is provided', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'mock_token';
    const bot = setupBot();
    expect(bot).toBeDefined();
    expect(typeof bot.launch).toBe('function');
  });
});
