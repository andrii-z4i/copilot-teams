/**
 * copilot-teams msg — send and read messages.
 */

import { parseFlags, resolveTeamName } from './helpers.js';
import { sendMessage, broadcastMessage, readMessages, readAllMessages } from '../comms/index.js';

const HELP = `
Usage: copilot-teams msg <subcommand> [options]

Subcommands:
  send <to> <body>       Send a message to a teammate (as Lead)
  broadcast <body>       Broadcast to all teammates
  read <recipient>       Read messages for a recipient
  list                   List all messages

Options:
  --from <name>       Sender name (default: lead)
  --since <id>        Read messages after this ID
  --team-name <name>
`.trim();

export async function cmdMessage(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);
  const sub = positional[0];

  if (!sub || flags['help']) {
    console.log(HELP);
    return;
  }

  const teamName = resolveTeamName(flags);
  const from = flags['from'] ?? 'lead';

  switch (sub) {
    case 'send': {
      const to = positional[1];
      const body = positional.slice(2).join(' ');
      if (!to || !body) {
        console.error('Usage: copilot-teams msg send <to> <message>');
        process.exit(1);
      }
      const msg = await sendMessage(teamName, from, to, body);
      console.log(`✓ Message #${msg.id} sent to ${to}.`);
      break;
    }
    case 'broadcast': {
      const body = positional.slice(1).join(' ');
      if (!body) { console.error('Usage: copilot-teams msg broadcast <message>'); process.exit(1); }
      const result = await broadcastMessage(teamName, from, body);
      console.log(`✓ Broadcast #${result.message.id} sent.`);
      if (result.costWarning) {
        console.warn(`⚠ ${result.costWarning}`);
      }
      break;
    }
    case 'read': {
      const recipient = positional[1];
      if (!recipient) { console.error('Usage: copilot-teams msg read <recipient>'); process.exit(1); }
      const sinceId = flags['since'] ? Number(flags['since']) : 0;
      const msgs = readMessages(teamName, recipient, sinceId);
      if (msgs.length === 0) {
        console.log(`No messages for ${recipient}.`);
        return;
      }
      for (const m of msgs) {
        console.log(`  [#${m.id}] ${m.timestamp} ${m.from} → ${m.to}: ${m.body}`);
      }
      break;
    }
    case 'list':
    case 'ls': {
      const msgs = readAllMessages(teamName);
      if (msgs.length === 0) {
        console.log('No messages.');
        return;
      }
      for (const m of msgs) {
        console.log(`  [#${m.id}] ${m.from} → ${m.to}: ${m.body}`);
      }
      console.log(`\n${msgs.length} messages.`);
      break;
    }
    default:
      console.error(`Unknown subcommand: msg ${sub}`);
      console.log(HELP);
      process.exit(1);
  }
}
