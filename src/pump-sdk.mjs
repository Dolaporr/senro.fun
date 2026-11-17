// Single loader for the Pump SDK root package.
// In Node, '#pump-sdk' resolves to the SDK's CommonJS build (see src/pump-sdk-node.cjs), and Node
// exposes only a `default` export for it. Bundlers keep the ESM build with named exports.
// Both shapes are normalised to the same namespace-like object.
let promise;
export const loadPumpSdk=()=>promise??=import('#pump-sdk').then(ns=>ns.PUMP_SDK?ns:ns.default);
