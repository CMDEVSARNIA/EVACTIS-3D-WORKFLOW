// Runs in every page of Studio and the Viewer before any app script (a Tauri
// initialization script; the e2e tests inject the same file). Object.prototype becomes
// immutable, so nothing can pollute it, as with Tauri's `freezePrototype`. Unlike a plain
// Object.freeze, assigning an inherited name such as `toString` or `valueOf` on another
// object still works (it defines an own property, as it would unfrozen): pdf-lib and
// fontkit do this when they load, and a plain freeze makes them throw (the "override
// mistake"). Same technique as SES's property-override enablements. ADR 0016.
(() => {
  'use strict';
  const proto = Object.prototype;
  if (Object.isFrozen(proto)) return;
  const { defineProperty, getOwnPropertyDescriptor } = Object;
  for (const name of Reflect.ownKeys(proto)) {
    const d = getOwnPropertyDescriptor(proto, name);
    if (!d || !('value' in d)) continue;
    const value = d.value;
    defineProperty(proto, name, {
      configurable: false,
      enumerable: d.enumerable,
      get() {
        return value;
      },
      set(v) {
        if (this === proto)
          throw new TypeError(
            `Cannot assign to read only property '${String(name)}' of Object.prototype`,
          );
        defineProperty(this, name, {
          value: v,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      },
    });
  }
  Object.freeze(proto);
})();
