# Launchpad browser check

Runs the built launchpad page in headless Chrome against a local stack.

Real: the browser bundle, the Pump SDK, `worker/launch-rpc.mjs`, `worker/launchpad-upload.mjs`.
Mocked: the Solana upstream RPC, the IPFS provider and gateway, and the wallet (a local test key with no funds).
Nothing touches a network. It proves the page and flow work end to end; it does not prove a live launch.

    npm run e2e:launchpad

Needs Chrome. Set `CHROME=/path/to/chrome` if it is not at /usr/bin/google-chrome. Screenshots go to your temp folder.
