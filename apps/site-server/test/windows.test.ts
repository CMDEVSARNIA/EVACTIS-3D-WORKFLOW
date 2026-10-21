import { describe, expect, it } from 'vitest';
import { taskXml } from '../src/windows.ts';

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
});
