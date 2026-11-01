/**
 * Interactive Provider Config Generator
 *
 * AI-powered assistant that helps you configure OAuth providers
 * Just answer a few questions and get a ready-to-use JSON config!
 *
 * Usage: npm run example:provider-config
 */

import 'dotenv/config';
import * as readline from 'readline';
import { Connector, Vendor, ProviderConfigAgent } from '../src/index.js';
import type { ConnectorConfigResult } from '../src/index.js';
import * as fs from 'fs';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function main() {
  console.clear();
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     🔌 OAuth Provider Configuration Generator              ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('AI-powered assistant to help you configure OAuth providers');
  console.log('Just answer a few questions and get a ready-to-use config!');
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // Check for OpenAI API key
  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    console.error('❌ No AI provider configured!');
    console.error('   Please add OPENAI_API_KEY or ANTHROPIC_API_KEY to your .env file');
    process.exit(1);
  }

  // Create connector
  let connectorName = 'openai';
  if (process.env.OPENAI_API_KEY) {
    Connector.create({
      name: 'openai',
      vendor: Vendor.OpenAI,
      auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY },
    });
    connectorName = 'openai';
  } else if (process.env.ANTHROPIC_API_KEY) {
    Connector.create({
      name: 'anthropic',
      vendor: Vendor.Anthropic,
      auth: { type: 'api_key', apiKey: process.env.ANTHROPIC_API_KEY },
    });
    connectorName = 'anthropic';
  }

  // Create provider config agent
  const configAgent = new ProviderConfigAgent(connectorName);

  console.log('🤖 Assistant: Hello! I\'ll help you configure an OAuth provider.');
  console.log('             Which system would you like to connect to?');
  console.log('');
  console.log('💡 Examples: GitHub, Google, Microsoft, Salesforce, Slack, etc.');
  console.log('');

  // Interactive conversation loop
  let isFirstMessage = true;

  const askQuestion = () => {
    rl.question('👤 You: ', async (answer) => {
      if (!answer.trim()) {
        askQuestion();
        return;
      }

      // Handle exit commands
      if (['exit', 'quit', 'q'].includes(answer.toLowerCase().trim())) {
        console.log('\n👋 Goodbye!');
        configAgent.destroy();
        rl.close();
        process.exit(0);
      }

      console.log('');

      try {
        let response: string | ConnectorConfigResult;

        if (isFirstMessage) {
          // First run - start the conversation
          response = await configAgent.run(answer);
          isFirstMessage = false;
        } else {
          // Continue conversation
          response = await configAgent.continue(answer);
        }

        // Check if we got a final config (object) or conversational response (string)
        if (typeof response !== 'string') {
          // We got the final config!
          console.log('\n✅ Configuration generated successfully!\n');
          displayConfig(response);

          // Ask if user wants to save
          rl.question('\n💾 Save to file? (yes/no): ', (saveAnswer) => {
            if (saveAnswer.toLowerCase().trim() === 'yes' || saveAnswer.toLowerCase().trim() === 'y') {
              saveConfig(response);
            }

            console.log('\n✨ Done! You can now use this config with Connector.create()');
            console.log('\n👋 Goodbye!');
            configAgent.destroy();
            rl.close();
            process.exit(0);
          });
          return;
        }

        // Otherwise, show the conversational response and continue
        console.log('🤖 Assistant:', response);
        console.log('');

        askQuestion();
      } catch (error) {
        console.error('\n❌ Error:', (error as Error).message);
        console.log('');
        askQuestion();
      }
    });
  };

  askQuestion();
}

/**
 * Display generated configuration
 */
function displayConfig(result: ConnectorConfigResult) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 Provider Configuration');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log(`Provider Name: ${result.name}`);
  console.log(`Display Name: ${result.config.displayName}`);
  console.log(`Auth Type: ${result.config.auth.type}`);
  if (result.config.auth.type === 'oauth') {
    console.log(`OAuth Flow: ${result.config.auth.flow}`);
  }
  console.log('');

  console.log('📝 Setup Instructions:');
  console.log(result.setupInstructions);
  console.log('');

  console.log('🔑 Environment Variables:');
  for (const envVar of result.envVariables) {
    console.log(`   ${envVar}=your-value-here`);
  }
  console.log('');

  console.log('💻 Code to Register:');
  console.log('```typescript');
  console.log(`import { Connector } from 'oneringai';`);
  console.log('');
  console.log(`Connector.create({ name: '${result.name}', ...${JSON.stringify(result.config, null, 2)} });`);
  console.log('```');
  console.log('');

  console.log('📄 Full JSON:');
  console.log(JSON.stringify(result, null, 2));
}

/**
 * Save configuration to file
 */
function saveConfig(result: ConnectorConfigResult) {
  const filename = `oauth-${result.name}-config.json`;
  fs.writeFileSync(filename, JSON.stringify(result, null, 2));
  console.log(`\n✅ Saved to: ${filename}`);
}

// Handle Ctrl+C
rl.on('SIGINT', () => {
  console.log('\n\n👋 Goodbye!');
  process.exit(0);
});

main().catch((error) => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
