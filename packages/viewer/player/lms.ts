/**
 * SCORM runtime bridge (Phase 8): reports a training module's result to the client's
 * LMS through the API object the LMS page provides (SCORM 1.2 `API`, SCORM 2004
 * `API_1484_11`), found in a parent or opener window. Talks to that object only — no
 * network of its own. Without an LMS the player runs exactly the same, unreported.
 */
import type { ModuleResult } from '../src/training.ts';

type Value = string;
interface Api12 {
  LMSInitialize(p: ''): Value;
  LMSFinish(p: ''): Value;
  LMSGetValue(k: string): Value;
  LMSSetValue(k: string, v: string): Value;
  LMSCommit(p: ''): Value;
  LMSGetLastError(): Value;
}
interface Api2004 {
  Initialize(p: ''): Value;
  Terminate(p: ''): Value;
  GetValue(k: string): Value;
  SetValue(k: string, v: string): Value;
  Commit(p: ''): Value;
  GetLastError(): Value;
}

type Found = { version: '1.2'; api: Api12 } | { version: '2004'; api: Api2004 };

/** Looks for the LMS API up the frame chain (at most 10 levels, per ADL), then the opener's. */
export function findApi(start: Window): Found | null {
  const search = (w: Window): Found | null => {
    let cur: Window | null = w;
    for (let i = 0; cur && i < 10; i++) {
      try {
        const x = cur as unknown as { API_1484_11?: Api2004; API?: Api12 };
        if (x.API_1484_11) return { version: '2004', api: x.API_1484_11 };
        if (x.API) return { version: '1.2', api: x.API };
      } catch {
        // A cross-origin frame without the API: keep looking.
      }
      if (cur.parent === cur) break;
      cur = cur.parent;
    }
    return null;
  };
  return search(start) ?? (start.opener ? search(start.opener as Window) : null);
}

/** Seconds as SCORM 1.2 CMITimespan (HHHH:MM:SS.SS). */
export function timespan12(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s - h * 3600 - m * 60;
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return `${pad(h, 4)}:${pad(m, 2)}:${sec.toFixed(2).padStart(5, '0')}`;
}

/** Seconds as an ISO 8601 duration (SCORM 2004 timeinterval). */
export function duration2004(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round((s - h * 3600 - m * 60) * 100) / 100;
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${sec}S`;
}

/** "Last, First" (the SCORM convention) as "First Last". */
export function displayName(lms: string): string {
  const [last, first] = lms.split(',').map((x) => x.trim());
  return first ? `${first} ${last}` : (last ?? '');
}

export class Lms {
  private started = performance.now();
  private finished = false;
  private passedOnce = false;

  private constructor(private found: Found) {}

  /** Connects and initializes; null when no LMS is present (or it refuses). */
  static connect(w: Window = window): Lms | null {
    const found = findApi(w);
    if (!found) return null;
    const ok = found.version === '1.2' ? found.api.LMSInitialize('') : found.api.Initialize('');
    if (String(ok) !== 'true') return null;
    const lms = new Lms(found);
    lms.begin();
    return lms;
  }

  get version(): '1.2' | '2004' {
    return this.found.version;
  }

  private get(k12: string, k2004: string): string {
    const f = this.found;
    return f.version === '1.2' ? f.api.LMSGetValue(k12) : f.api.GetValue(k2004);
  }

  private set(k: string, v: string | number) {
    const f = this.found;
    if (f.version === '1.2') f.api.LMSSetValue(k, String(v));
    else f.api.SetValue(k, String(v));
  }

  private commit() {
    const f = this.found;
    if (f.version === '1.2') f.api.LMSCommit('');
    else f.api.Commit('');
  }

  /** The learner's name from the LMS ("First Last"), for the certificate. */
  get learnerName(): string {
    return displayName(this.get('cmi.core.student_name', 'cmi.learner_name'));
  }

  private begin() {
    if (this.found.version === '1.2') {
      const status = this.get('cmi.core.lesson_status', '');
      this.passedOnce = status === 'passed';
      if (status === 'not attempted' || status === '')
        this.set('cmi.core.lesson_status', 'incomplete');
    } else {
      this.passedOnce = this.get('', 'cmi.success_status') === 'passed';
      if (this.get('', 'cmi.completion_status') !== 'completed')
        this.set('cmi.completion_status', 'incomplete');
    }
    this.commit();
  }

  /** A finished attempt: score, completion and success (a pass is never downgraded). */
  complete(r: ModuleResult): void {
    if (this.finished) return;
    const passed = r.passed || this.passedOnce;
    this.passedOnce = passed;
    if (this.found.version === '1.2') {
      this.set('cmi.core.score.min', 0);
      this.set('cmi.core.score.max', 100);
      this.set('cmi.core.score.raw', r.percent);
      this.set('cmi.core.lesson_status', passed ? 'passed' : 'failed');
    } else {
      this.set('cmi.score.min', 0);
      this.set('cmi.score.max', 100);
      this.set('cmi.score.raw', r.percent);
      this.set('cmi.score.scaled', (r.percent / 100).toFixed(2));
      this.set('cmi.completion_status', 'completed');
      this.set('cmi.success_status', passed ? 'passed' : 'failed');
    }
    this.commit();
  }

  /** Ends the session (the learner leaves or the LMS closes the window). */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    const s = (performance.now() - this.started) / 1000;
    if (this.found.version === '1.2') {
      this.set('cmi.core.session_time', timespan12(s));
      this.set('cmi.core.exit', '');
      this.found.api.LMSCommit('');
      this.found.api.LMSFinish('');
    } else {
      this.set('cmi.session_time', duration2004(s));
      this.set('cmi.exit', 'normal');
      this.found.api.Commit('');
      this.found.api.Terminate('');
    }
  }
}
