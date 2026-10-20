/**
 * A strict, local stand-in for an LMS (SCORM 1.2 `API` and SCORM 2004 `API_1484_11`),
 * used by e2e/scorm.spec.ts. It launches a SCO from the package's imsmanifest.xml and
 * records every call; misuse (wrong order, unknown elements, read-only writes, bad
 * vocabulary or formats) is collected in `lms.errors` instead of being tolerated.
 *
 *   index.html?pkg=scorm12&item=item-aed-floor-2
 */
const params = new URLSearchParams(location.search);
const pkg = params.get('pkg');
const item = params.get('item');

const lms = { version: null, log: [], data: {}, errors: [], state: 'idle' };
window.lms = lms;

const num = (v, min, max) =>
  v !== '' && !Number.isNaN(Number(v)) && Number(v) >= min && Number(v) <= max;
const RULES = {
  1.2: {
    'cmi.core.student_name': { ro: true },
    'cmi.core.student_id': { ro: true },
    'cmi.core.lesson_status': {
      ok: (v) =>
        ['passed', 'completed', 'failed', 'incomplete', 'browsed', 'not attempted'].includes(v),
    },
    'cmi.core.score.raw': { ok: (v) => num(v, 0, 100) },
    'cmi.core.score.min': { ok: (v) => num(v, 0, 100) },
    'cmi.core.score.max': { ok: (v) => num(v, 0, 100) },
    'cmi.core.session_time': { wo: true, ok: (v) => /^\d{2,4}:\d{2}:\d{2}(\.\d{1,2})?$/.test(v) },
    'cmi.core.exit': { wo: true, ok: (v) => ['time-out', 'suspend', 'logout', ''].includes(v) },
    'cmi.suspend_data': { ok: (v) => v.length <= 4096 },
  },
  2004: {
    'cmi.learner_name': { ro: true },
    'cmi.learner_id': { ro: true },
    'cmi.completion_status': {
      ok: (v) => ['completed', 'incomplete', 'not attempted', 'unknown'].includes(v),
    },
    'cmi.success_status': { ok: (v) => ['passed', 'failed', 'unknown'].includes(v) },
    'cmi.score.scaled': { ok: (v) => num(v, -1, 1) },
    'cmi.score.raw': { ok: (v) => !Number.isNaN(Number(v)) && v !== '' },
    'cmi.score.min': { ok: (v) => !Number.isNaN(Number(v)) && v !== '' },
    'cmi.score.max': { ok: (v) => !Number.isNaN(Number(v)) && v !== '' },
    'cmi.session_time': {
      wo: true,
      ok: (v) =>
        /^P(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d{1,2})?S)?)?$/.test(v) &&
        v !== 'P' &&
        v !== 'PT',
    },
    'cmi.exit': {
      wo: true,
      ok: (v) => ['time-out', 'suspend', 'logout', 'normal', ''].includes(v),
    },
    'cmi.suspend_data': { ok: (v) => v.length <= 64000 },
  },
};

function api(version) {
  lms.version = version;
  const rules = RULES[version];
  Object.assign(
    lms.data,
    version === '1.2'
      ? {
          'cmi.core.student_name': 'Tremblay, Marie-Ève',
          'cmi.core.student_id': 'mt-001',
          'cmi.core.lesson_status': 'not attempted',
        }
      : {
          'cmi.learner_name': 'Tremblay, Marie-Ève',
          'cmi.learner_id': 'mt-001',
          'cmi.completion_status': 'not attempted',
          'cmi.success_status': 'unknown',
        },
  );
  let last = '0';
  const fail = (call, code, why) => {
    last = String(code);
    lms.errors.push(`${call}: ${why}`);
    return 'false';
  };
  const running = (call) =>
    lms.state === 'running'
      ? true
      : (fail(
          call,
          version === '1.2' ? 301 : lms.state === 'idle' ? 122 : 133,
          `called while ${lms.state}`,
        ),
        false);
  const calls = {
    init(p) {
      lms.log.push(['Initialize', p]);
      if (p !== '') return fail('Initialize', 201, 'argument must be ""');
      if (lms.state !== 'idle')
        return fail('Initialize', version === '1.2' ? 101 : 103, `already ${lms.state}`);
      lms.state = 'running';
      last = '0';
      return 'true';
    },
    finish(p) {
      lms.log.push(['Terminate', p]);
      if (!running('Terminate')) return 'false';
      lms.state = 'terminated';
      last = '0';
      return 'true';
    },
    get(k) {
      lms.log.push(['GetValue', k]);
      if (!running('GetValue')) return '';
      const r = rules[k];
      if (!r) return (fail(`GetValue ${k}`, 401, 'unknown element'), '');
      if (r.wo) return (fail(`GetValue ${k}`, version === '1.2' ? 404 : 405, 'write-only'), '');
      last = '0';
      return lms.data[k] ?? '';
    },
    set(k, v) {
      lms.log.push(['SetValue', k, v]);
      if (!running('SetValue')) return 'false';
      const r = rules[k];
      if (!r) return fail(`SetValue ${k}`, 401, 'unknown element');
      if (r.ro) return fail(`SetValue ${k}`, version === '1.2' ? 403 : 404, 'read-only');
      if (typeof v !== 'string') return fail(`SetValue ${k}`, 405, 'value must be a string');
      if (r.ok && !r.ok(v))
        return fail(`SetValue ${k}`, version === '1.2' ? 405 : 406, `bad value "${v}"`);
      lms.data[k] = v;
      last = '0';
      return 'true';
    },
    commit(p) {
      lms.log.push(['Commit', p]);
      if (!running('Commit')) return 'false';
      lms.committed = { ...lms.data };
      return 'true';
    },
  };
  return version === '1.2'
    ? {
        LMSInitialize: calls.init,
        LMSFinish: calls.finish,
        LMSGetValue: calls.get,
        LMSSetValue: calls.set,
        LMSCommit: calls.commit,
        LMSGetLastError: () => last,
        LMSGetErrorString: () => '',
        LMSGetDiagnostic: () => '',
      }
    : {
        Initialize: calls.init,
        Terminate: calls.finish,
        GetValue: calls.get,
        SetValue: calls.set,
        Commit: calls.commit,
        GetLastError: () => last,
        GetErrorString: () => '',
        GetDiagnostic: () => '',
      };
}

const status = document.getElementById('status');
try {
  const text = await (await fetch(`./${pkg}/imsmanifest.xml`)).text();
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('imsmanifest.xml is not well-formed');
  const version = doc.querySelector('schemaversion')?.textContent?.startsWith('2004')
    ? '2004'
    : '1.2';
  if (version === '1.2') window.API = api('1.2');
  else window.API_1484_11 = api('2004');
  const el = [...doc.getElementsByTagName('item')].find(
    (i) => i.getAttribute('identifier') === item,
  );
  if (!el) throw new Error(`No item ${item}`);
  const res = [...doc.getElementsByTagName('resource')].find(
    (r) => r.getAttribute('identifier') === el.getAttribute('identifierref'),
  );
  const type = res?.getAttribute(version === '1.2' ? 'adlcp:scormtype' : 'adlcp:scormType');
  if (type !== 'sco') throw new Error(`Item ${item} does not launch a SCO`);
  const frame = document.createElement('iframe');
  frame.title = 'Course';
  frame.src = `./${pkg}/${res.getAttribute('href')}${el.getAttribute('parameters') ?? ''}`;
  document.getElementById('course').append(frame);
  lms.launched = frame.getAttribute('src');
  status.textContent = `SCORM ${version}: ${el.querySelector('title')?.textContent}`;
} catch (e) {
  status.textContent = String(e);
  lms.errors.push(String(e));
}
document.getElementById('exit').addEventListener('click', () => {
  document.querySelector('iframe')?.remove();
  status.textContent = 'exited';
});
document.body.dataset.ready = 'true';
