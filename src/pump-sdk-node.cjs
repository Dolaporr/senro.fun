// Node-only entry for the Pump SDK root package.
// @pump-fun/pump-sdk's ESM build imports `BN` by name from the CommonJS @coral-xyz/anchor,
// which Node's ESM loader cannot detect, so a native `import('@pump-fun/pump-sdk')` throws
// "Named export 'BN' not found". Its CommonJS build works. package.json "imports" maps
// `#pump-sdk` here under the "node" condition only; bundlers (Vite) keep the ESM package.
module.exports = require('@pump-fun/pump-sdk');
