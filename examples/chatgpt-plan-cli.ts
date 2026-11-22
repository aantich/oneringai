import { spawn } from 'node:child_process';
import { Agent, Connector } from 'oneringai';
import { ChatGPTPlanAuth, type OAuthSessionStorage } from 'oneringai/auth/openai';

function openBrowser(url: string): Promise<void> {
  const [command, ...args] = process.platform === 'darwin' ? ['open', url]
    : process.platform === 'win32' ? ['rundll32.exe', 'url.dll,FileProtocolHandler', url]
    : ['xdg-open', url];
  return new Promise((resolve, reject) => {
    const browser = spawn(command!, args, { stdio: 'ignore', detached: true, windowsHide: true });
    browser.once('error', reject);
    browser.once('spawn', () => { browser.unref(); resolve(); });
  });
}

async function main() {
  const [mode, model = 'gpt-5.6-terra', prompt = 'Give one tip for writing maintainable TypeScript.'] = process.argv.slice(2);
  if (mode !== '--live' || process.env.ONERINGAI_ALLOW_LIVE === '0') {
    console.log('Usage: npm run example:chatgpt-plan -- --live [model] [prompt]');
    console.log('Requires a system browser and an eligible ChatGPT plan. The run uses your plan allowance or available credits.');
    return;
  }

  // The example is disposable. A real app supplies its own protected, persistent store.
  let snapshot: string | null = null;
  const storage: OAuthSessionStorage = {
    async load() { return snapshot; },
    async save(next) { snapshot = next; },
  };
  const auth = new ChatGPTPlanAuth({ applicationName: 'OneRingAI ChatGPT Plan Example', storage, openBrowser });
  await auth.initialize();
  const interrupt = () => { auth.cancel(); agent?.cancel(); };
  process.once('SIGINT', interrupt);
  let agent: Agent | undefined;
  let accountId: string | undefined;
  let connector: Connector | undefined;
  try {
    const account = await auth.signIn();
    accountId = account.id;
    if (!account.planEnabled) throw new Error('ChatGPT plan access was declined. Enable it in the consent screen to run the example.');
    connector = auth.createConnector('example-chatgpt-plan', account.id);
    agent = Agent.create({ connector: connector.name, model,
      context: { model, features: { workingMemory: false, inContextMemory: false } } });
    const result = await agent.run(prompt);
    console.log(result.output_text);
  } finally {
    process.removeListener('SIGINT', interrupt);
    agent?.destroy();
    if (connector) Connector.remove(connector.name);
    if (accountId) {
      const { warning } = await auth.signOut(accountId);
      if (warning) console.warn(warning);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'ChatGPT plan example failed');
  process.exitCode = 1;
});
