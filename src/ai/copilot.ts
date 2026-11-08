import { type AiProvider, CONFIG_DIR_PLACEHOLDER } from './cli-runner.js';

/**
 * Locked down: an empty configuration folder keeps the user's MCP servers, hooks, plugins and instructions
 * out (sign-in is kept by the system keychain), tools are filtered to a name that does not exist and
 * shell/write are denied as well.
 */
export const copilotCliProvider = (command = process.env.MOCK_STUDIO_COPILOT_BIN || 'copilot'): AiProvider => ({
  id: 'copilot-cli',
  name: 'GitHub Copilot CLI',
  invocation(prompt) {
    return {
      command,
      args: [
        '--config-dir',
        CONFIG_DIR_PLACEHOLDER,
        '--available-tools=none',
        '--deny-tool=shell',
        '--deny-tool=write',
        '--no-ask-user',
        '--no-custom-instructions',
        '--disable-builtin-mcps',
        '--no-auto-update',
        '--no-remote',
        '--no-color',
        '--disallow-temp-dir',
        '--silent',
        '-p',
        prompt,
      ],
    };
  },
});
