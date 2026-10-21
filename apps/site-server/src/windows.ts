/**
 * Running the Site Server unattended on Windows, with nothing else to install: a
 * scheduled task that starts the standalone program at boot as the built-in LOCAL
 * SERVICE account (no password, few rights), restarts it if it stops, and inbound
 * firewall rules limited to the site's allowed networks. (A Node program cannot answer
 * the Service Control Manager itself; a scheduled task needs no wrapper program.)
 *
 *   evactis-3dworkflow-site-server install-task --data D:\EvactisSite
 *   evactis-3dworkflow-site-server uninstall-task
 *
 * Run from an elevated prompt. The data folder is kept on uninstall.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, win32 } from 'node:path';
import { loadConfig } from './config.ts';

export const TASK = 'EVACTIS 3DWORKFLOW Site Server';
const RULE = 'EVACTIS 3DWORKFLOW Site Server';
const LOCAL_SERVICE = 'S-1-5-19';

const xmlText = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The task definition (Task Scheduler schema 1.2, understood by Windows 10 and later). */
export function taskXml(program: string, dataDir: string): string {
  const args = `--data "${dataDir}" --log "${win32.join(dataDir, 'site-server.log')}"`;
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>Evactis</Author>
    <Description>EVACTIS 3DWORKFLOW Site Server: shared notes and guided sessions on the site network only.</Description>
  </RegistrationInfo>
  <Triggers>
    <BootTrigger><Enabled>true</Enabled></BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${LOCAL_SERVICE}</UserId>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>5</Priority>
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlText(program)}</Command>
      <Arguments>${xmlText(args)}</Arguments>
      <WorkingDirectory>${xmlText(dataDir)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

const run = (cmd: string, args: string[], quiet = false) =>
  execFileSync(cmd, args, { stdio: quiet ? 'ignore' : 'inherit', windowsHide: true });

export function installTask(dataArg: string | undefined): void {
  if (process.platform !== 'win32') throw new Error('install-task is for Windows.');
  const dataDir = resolve(dataArg ?? 'site-data');
  mkdirSync(dataDir, { recursive: true });
  // Writes the default config now, so the firewall rules use the site's networks.
  const config = loadConfig(dataDir);
  // LOCAL SERVICE may change the data folder (database, uploads, certificates, log).
  run('icacls', [dataDir, '/grant', `*${LOCAL_SERVICE}:(OI)(CI)M`, '/T', '/Q']);

  const file = join(tmpdir(), `evx-site-task-${process.pid}.xml`);
  writeFileSync(file, Buffer.from(`\uFEFF${taskXml(process.execPath, dataDir)}`, 'utf16le'));
  try {
    run('schtasks', ['/Create', '/TN', TASK, '/XML', file, '/F']);
  } finally {
    rmSync(file, { force: true });
  }

  // Inbound only from the networks the server serves; no outbound rule is needed.
  powershell(
    firewallScript(process.execPath, firewallNetworks(config.allowedNetworks), [
      { name: 'HTTPS', protocol: 'TCP', ports: [String(config.port)] },
      {
        name: 'TURN',
        protocol: 'UDP',
        ports: [
          String(config.turn.port),
          `${config.turn.relayPorts[0]}-${config.turn.relayPorts[1]}`,
        ],
      },
    ]),
  );

  run('schtasks', ['/Run', '/TN', TASK]);
  console.log(
    `Installed: "${TASK}" starts at boot as LOCAL SERVICE and is running now.\n` +
      `Data and log: ${dataDir} (site-server.log holds the first-time setup code).`,
  );
}

/**
 * The site networks a firewall rule can name. Loopback is left out: Windows refuses it in
 * a rule ("loopback IPv6 address") and never filters loopback traffic anyway.
 */
export function firewallNetworks(networks: string[]): string[] {
  return networks.filter((n) => !/^(127\.|::1(\/|$)|::ffff:127\.)/i.test(n.trim()));
}

/** PowerShell string literal. */
const psText = (v: string) => `'${v.replace(/'/g, "''")}'`;
const psList = (vs: string[]) => `@(${vs.map(psText).join(',')})`;
const REMOVE_RULES = `Get-NetFirewallRule -Group ${psText(RULE)} -ErrorAction SilentlyContinue | Remove-NetFirewallRule`;

/**
 * Replaces the server's inbound firewall rules (one group, so uninstall finds them all).
 * PowerShell's firewall cmdlets take each value as a literal; netsh's own command-line
 * parser rejected the rule names and address lists passed from Node.
 */
export function firewallScript(
  program: string,
  networks: string[],
  rules: { name: string; protocol: 'TCP' | 'UDP'; ports: string[] }[],
): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    REMOVE_RULES,
    ...rules.map(
      (r) =>
        `New-NetFirewallRule -DisplayName ${psText(`${RULE} (${r.name})`)} -Group ${psText(RULE)} ` +
        `-Direction Inbound -Action Allow -Program ${psText(program)} -Protocol ${r.protocol} ` +
        `-LocalPort ${psList(r.ports)} -RemoteAddress ${psList(networks)} -Profile Any | Out-Null`,
    ),
  ].join('\n');
}

const powershell = (script: string, quiet = false) =>
  run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    quiet,
  );

function removeRules(): void {
  try {
    powershell(REMOVE_RULES, true);
  } catch {
    // none there
  }
}

export function uninstallTask(): void {
  if (process.platform !== 'win32') throw new Error('uninstall-task is for Windows.');
  try {
    run('schtasks', ['/End', '/TN', TASK], true);
  } catch {
    // not running
  }
  run('schtasks', ['/Delete', '/TN', TASK, '/F']);
  removeRules();
  console.log(`Removed "${TASK}" and its firewall rules. The data folder is kept.`);
}
