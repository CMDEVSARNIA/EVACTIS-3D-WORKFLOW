import type { Condition, Environment } from '@evactis-3dworkflow/schema';

export type VarValue = string | number | boolean;

/** Runtime state used by conditions: variables, visited scenes, audience, visibility overrides. */
export class ViewerState {
  readonly variables = new Map<string, VarValue>();
  readonly visited = new Set<string>();
  readonly visibility = new Map<string, boolean>();
  audience: string | null;

  constructor(env: Environment, audience: string | null) {
    for (const v of env.variables) this.variables.set(v.id, v.initial);
    this.audience = audience;
  }

  /** True when an item with these audience IDs is visible to the current audience. */
  inAudience(ids: string[]): boolean {
    return ids.length === 0 || (this.audience !== null && ids.includes(this.audience));
  }

  test(c: Condition | undefined): boolean {
    if (!c) return true;
    if ('all' in c) return c.all.every((x) => this.test(x));
    if ('any' in c) return c.any.some((x) => this.test(x));
    if ('not' in c) return !this.test(c.not);
    if ('visited' in c) return this.visited.has(c.visited);
    if ('audience' in c) return this.audience === c.audience;
    const v = this.variables.get(c.variable);
    switch (c.op) {
      case 'eq':
        return v === c.value;
      case 'neq':
        return v !== c.value;
      case 'gt':
        return Number(v) > Number(c.value);
      case 'gte':
        return Number(v) >= Number(c.value);
      case 'lt':
        return Number(v) < Number(c.value);
      case 'lte':
        return Number(v) <= Number(c.value);
    }
  }
}
