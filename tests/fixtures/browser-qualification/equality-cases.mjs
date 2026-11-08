export function createEqualityCases() {
  const symbol = Symbol('fixture');
  class A { value = 1; }
  class B { value = 1; }
  const cycle = () => { const value = { value: 1 }; value.self = value; return value; };
  return [
    ['JSON key order', { a: 1, b: 2 }, { b: 2, a: 1 }],
    ['signed zero', { a: 0 }, { a: -0 }],
    ['NaN', { a: NaN }, { a: NaN }],
    ['prototype identity', new A(), new B()],
    ['different custom prototypes', Object.assign(Object.create({}), { a: 1 }), Object.assign(Object.create({}), { a: 1 })],
    ['null prototype', Object.assign(Object.create(null), { a: 1 }), { a: 1 }],
    ['array holes', new Array(1), [undefined]],
    ['symbol keys', { [symbol]: 1 }, { [symbol]: 2 }],
    ['nonenumerable properties', Object.defineProperty({}, 'hidden', { value: 1 }), Object.defineProperty({}, 'hidden', { value: 2 })],
    ['property descriptors', Object.freeze({ a: 1 }), { a: 1 }],
    ['dates', new Date(123), new Date(123)],
    ['typed arrays', new Uint8Array([1, 2]), new Uint8Array([1, 2])],
    ['array buffer bytes', new Uint8Array([1, 2]).buffer, new Uint8Array([1, 3]).buffer],
    ['map structural keys', new Map([[{ a: 1 }, 2]]), new Map([[{ a: 1 }, 2]])],
    ['set order', new Set([{ a: 1 }, { a: 2 }]), new Set([{ a: 2 }, { a: 1 }])],
    ['cycles', cycle(), cycle()],
  ];
}
