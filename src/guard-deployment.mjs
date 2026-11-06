// Release-owned configuration, never read from localStorage, query strings or user input.
// Keep disabled until the exact build and browser transactions pass cluster validation.
export const GUARD_DEPLOYMENT=Object.freeze({
 enabled:false,
 programId:null,
 programData:null,
 executableSha256:null,
 upgradeAuthority:null,
});
