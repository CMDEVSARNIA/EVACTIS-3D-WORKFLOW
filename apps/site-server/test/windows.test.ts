import { describe, expect, it } from 'vitest';
import { firewallNetworks, firewallScript, taskXml } from '../src/windows.ts';

describe('Windows scheduled task', () => {
  const xml = taskXml(
    'C:\\Program Files\\Evactis\\evactis-3dworkflow-site-server.exe',
    'D:\\Site & Data',
  );

  it('starts at boot as LOCAL SERVICE with least privilege, and restarts on failure', () => {
    expect(xml).toContain('<BootTrigger><Enabled>true</Enabled></BootTrigger>');
    expect(xml).toContain('<UserId>S-1-5-19</UserId>');
    expect(xml).toContain('<RunLevel>LeastPrivilege</RunLevel>');
    expect(xml).toContain('<RestartOnFailure><Interval>PT1M</Interval>');
    expect(xml).toContain('<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>');
  });

  it('runs the program on the data folder with its log there, XML-escaped', () => {
    expect(xml).toContain(
      '<Command>C:\\Program Files\\Evactis\\evactis-3dworkflow-site-server.exe</Command>',
    );
    expect(xml).toContain(
      '<Arguments>--data &quot;D:\\Site &amp; Data&quot; --log &quot;D:\\Site &amp; Data\\site-server.log&quot;</Arguments>',
    );
    expect(xml).not.toMatch(/&(?!amp;|quot;|lt;|gt;)/);
  });

  it('limits inbound firewall rules to the site networks, as PowerShell literals', () => {
    const script = firewallScript(
      "C:\\Evactis's Site\\server.exe",
      ['10.0.0.0/8', 'fe80::/10'],
      [
        { name: 'HTTPS', protocol: 'TCP', ports: ['4392'] },
        { name: 'TURN', protocol: 'UDP', ports: ['3478', '49160-49200'] },
      ],
    );
    const lines = script.split('\n');
    expect(lines[0]).toBe("$ErrorActionPreference = 'Stop'");
    expect(lines[1]).toBe(
      "Get-NetFirewallRule -Group 'EVACTIS 3DWORKFLOW Site Server' -ErrorAction SilentlyContinue | Remove-NetFirewallRule",
    );
    expect(lines[2]).toBe(
      "New-NetFirewallRule -DisplayName 'EVACTIS 3DWORKFLOW Site Server (HTTPS)' -Group 'EVACTIS 3DWORKFLOW Site Server' " +
        "-Direction Inbound -Action Allow -Program 'C:\\Evactis''s Site\\server.exe' -Protocol TCP " +
        "-LocalPort @('4392') -RemoteAddress @('10.0.0.0/8','fe80::/10') -Profile Any | Out-Null",
    );
    expect(lines[3]).toContain("-Protocol UDP -LocalPort @('3478','49160-49200')");
  });

  it('leaves loopback out of the firewall rules (Windows refuses it there)', () => {
    expect(
      firewallNetworks(['10.0.0.0/8', '127.0.0.0/8', 'fc00::/7', 'fe80::/10', '::1/128', '::1']),
    ).toEqual(['10.0.0.0/8', 'fc00::/7', 'fe80::/10']);
  });
});
