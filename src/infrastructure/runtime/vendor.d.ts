declare module 'assert/build/internal/util/comparisons.js' {
  const comparisons: { isDeepStrictEqual(a: unknown, b: unknown): boolean };
  export default comparisons;
}
declare module 'util/support/types.js' {
  const predicates: Record<string, (value: unknown) => boolean>;
  export default predicates;
}
declare module 'json-schema-traverse' {
  type Callback = (schema: Record<string, any>, pointer: string, root: object, parentPointer?: string, parentKeyword?: string) => void;
  function traverse(schema: object, callback: Callback): void;
  function traverse(schema: object, options: { allKeys?: boolean }, callback: Callback): void;
  export default traverse;
}
